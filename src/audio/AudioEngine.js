/**
 * AudioEngine — بايبلاين تنظيف الصوت في الوقت الفعلي + تصدير WAV
 * ---------------------------------------------------------------
 * سلسلة المعالجة (مساران):
 *   المصدر (ملف صوتي / تسجيل محفوظ)
 *     ├─→ High-Pass (80Hz) → RNNoise → Peaking EQ → Compressor → Limiter → CleanGain ┐
 *     └─→ RawGain ───────────────────────────────────────────────────────────────────┤
 *                                                                              → Master → الوجهة + Analyser
 *
 * التبديل بين «نقي» و«الخام» يتم عبر تغيير الـ gains (CleanGain/RawGain) بمنحنى
 * سلس — دون فصل/وصل المصدر، فلا ينقطع الصوت أثناء التشغيل.
 *
 * التشغيل: AudioBufferSourceNode أحادي الاستخدام — عند الإيقاف نحفظ الموضع
 * (playbackOffset) وعند التشغيل ننشئ مصدراً جديداً ونبدأ من الموضع المحفوظ.
 */
import rnnoiseProcessorUrl from './rnnoise-processor.worklet.js?worker&url'
import { audioBufferToWav } from '../utils/wavEncoder.js'

export const PROCESS_SAMPLE_RATE = 48000 // إطار RNNoise = 480 عينة @ 48kHz
export const EXPORT_SAMPLE_RATE = 44100

const BYPASS_RAMP = 0.02 // ثوانٍ — منحنى سلس لتفادي النقرات عند التبديل

export class AudioEngine {
  constructor() {
    this.ctx = null
    this.bypassed = false

    this.nodes = {}

    this.micStream = null
    this._recState = null // التسجيل الحي: { stream, micSource, micAnalyser, recDest, recorder, chunks }

    this.bufferSource = null
    this._sourceStarted = false // هل بدأ المصدر الحالي فعلاً؟ (أحادي الاستخدام بعد start)
    this._buffer = null

    // تتبع موضع التشغيل
    this._playbackOffset = 0
    this._startTime = 0
    this.onPlaybackEnd = null // يُستدعى عند انتهاء الملف طبيعياً
  }

  /* ---------- بناء سلسلة المعالجة (مشتركة: حية + Offline) ---------- */

  _buildChain(ctx, { withAnalyser = true } = {}) {
    // 1) High-Pass — قص الهمهمة والترددات المنخفضة
    const highpass = ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 80
    highpass.Q.value = 0.707

    // 2) RNNoise — إلغاء ضوضاء الخلفية
    const rnnoise = new AudioWorkletNode(ctx, 'rnnoise-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    })

    // 3) Peaking EQ — حضور الصوت
    const peaking = ctx.createBiquadFilter()
    peaking.type = 'peaking'
    peaking.frequency.value = 3500
    peaking.gain.value = 2.5
    peaking.Q.value = 1.0

    // 4) Dynamics Compressor — تسوية مستوى الصوت
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -20
    compressor.knee.value = 10
    compressor.ratio.value = 4
    compressor.attack.value = 0.003
    compressor.release.value = 0.25

    // 5) Limiter — حماية من القص/التشويش
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -1
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.001
    limiter.release.value = 0.05

    // 6) Master Gain
    const master = ctx.createGain()
    master.gain.value = 1.0

    // 7) مساران: نظيف (بعد المعالجة) وخام (مباشر) — التبديل عبر gains بلا انقطاع
    const cleanGain = ctx.createGain()
    cleanGain.gain.value = this.bypassed ? 0 : 1
    const rawGain = ctx.createGain()
    rawGain.gain.value = this.bypassed ? 1 : 0

    // الوصل
    highpass.connect(rnnoise)
    rnnoise.connect(peaking)
    peaking.connect(compressor)
    compressor.connect(limiter)
    limiter.connect(cleanGain)
    cleanGain.connect(master)
    rawGain.connect(master)
    master.connect(ctx.destination)

    const chain = {
      highpass,
      rnnoise,
      peaking,
      compressor,
      limiter,
      master,
      cleanGain,
      rawGain,
    }

    if (withAnalyser) {
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.75
      master.connect(analyser)
      chain.analyser = analyser
    }

    return chain
  }

  /* ---------- الإعداد ---------- */

  async ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume()
      return this.ctx
    }

    const ctx = new AudioContext({ sampleRate: PROCESS_SAMPLE_RATE })
    await ctx.audioWorklet.addModule(rnnoiseProcessorUrl)
    this.ctx = ctx
    this.nodes = this._buildChain(ctx, { withAnalyser: true })
    return ctx
  }

  /**
   * يوصّل مصدراً بالمسارين (نظيف + خام) بشكل دائم —
   * التبديل لاحقاً عبر gains فقط، فلا انقطاع للصوت.
   */
  _connectSource(source) {
    source.connect(this.nodes.highpass)
    source.connect(this.nodes.rawGain)
  }

  /* ---------- التسجيل الحي (ميكروفون → تسجيل فقط، لا سماعات) ---------- */

  /**
   * يبدأ تسجيلاً من الميكروفون.
   *
   * ⚠️ منع الارتجاع الصوتي: إشارة الميكروفون لا تمر أبداً عبر سلسلة المعالجة
   * ولا تصل إلى ctx.destination (السماعات). تتصل فقط بـ:
   *   a) micAnalyser — للفيجوالايزر الحي على اللوحة.
   *   b) recDest (MediaStreamDestination) — لتغذية MediaRecorder.
   * الصوت لا يُسمع إلا عند الضغط على «تشغيل» لاحقاً (مسار الملف العادي).
   */
  async startRecording() {
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('متصفحك لا يدعم التسجيل الصوتي — استخدم «رفع ملف صوتي»')
    }
    const ctx = await this.ensureContext()
    if (this._recState) return // يسجّل بالفعل

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })

    const micSource = ctx.createMediaStreamSource(stream)

    // a) فيجوالايزر حي — يقرأ طاقة الميكروفون فقط
    const micAnalyser = ctx.createAnalyser()
    micAnalyser.fftSize = 2048
    micAnalyser.smoothingTimeConstant = 0.75
    micSource.connect(micAnalyser)

    // b) وجهة التسجيل — MediaStreamDestination، وليست ctx.destination!
    const recDest = ctx.createMediaStreamDestination()
    micSource.connect(recDest)

    // MediaRecorder يسجّل من تدفق وجهة التسجيل (صوت الميكروفون الخام)
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    const mimeType = candidates.find((t) => MediaRecorder.isTypeSupported(t))
    const recorder = mimeType
      ? new MediaRecorder(recDest.stream, { mimeType })
      : new MediaRecorder(recDest.stream)

    const chunks = []
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data)
    }

    this.micStream = stream
    this._recState = { stream, micSource, micAnalyser, recDest, recorder, chunks }
    recorder.start()
  }

  /**
   * يوقف التسجيل، يجمع الصوت في Blob، يفك ترميزه إلى AudioBuffer،
   * ويحقنه في مساحة العمل (نفس مسار الملف المرفوع: تشغيل + مقارنة + تنزيل).
   */
  async stopRecording() {
    const rec = this._recState
    if (!rec) throw new Error('لا يوجد تسجيل نشط')

    // جمع الـ Blob أولاً (ناتج stop) ثم تنظيف الميكروفون
    const blob = await new Promise((resolve, reject) => {
      rec.recorder.onstop = () =>
        resolve(new Blob(rec.chunks, { type: rec.recorder.mimeType || 'audio/webm' }))
      rec.recorder.onerror = () => reject(new Error('فشل تسجيل الصوت'))
      try {
        rec.recorder.stop()
      } catch {
        resolve(new Blob(rec.chunks, { type: rec.recorder.mimeType || 'audio/webm' }))
      }
    })

    // تنظيف عقد التسجيل + إيقاف الميكروفون
    this._recState = null
    try {
      rec.micSource.disconnect()
      rec.micAnalyser.disconnect()
      rec.recDest.disconnect()
    } catch {
      /* لا وصلات */
    }
    rec.stream.getTracks().forEach((t) => t.stop())
    this.micStream = null

    if (blob.size === 0) throw new Error('التسجيل قصير جداً — جرّب تسجيلاً أطول')

    // فك الترميز → حقن في مساحة العمل
    const arrayBuffer = await blob.arrayBuffer()
    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer)
    this._loadAudioBuffer(audioBuffer)

    return { blob, audioBuffer, duration: audioBuffer.duration }
  }

  isRecording() {
    return !!this._recState
  }

  /* ---------- ملف صوتي ---------- */

  async loadAudioFile(file) {
    const ctx = await this.ensureContext()
    const arrayBuffer = await file.arrayBuffer()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    this._loadAudioBuffer(audioBuffer)
    return audioBuffer
  }

  /**
   * يحقن AudioBuffer في مساحة العمل (ملف مرفوع أو تسجيل ميكروفون):
   * يوقف التشغيل الحالي، يصفّر الموضع، ويجهّز مصدراً جاهزاً للتشغيل.
   */
  _loadAudioBuffer(audioBuffer) {
    this.stopBuffer()
    this._buffer = audioBuffer
    this._playbackOffset = 0 // محتوى جديد → ابدأ من الصفر

    // إنشاء المصدر الجديد وربطه بالسلسلة (جاهز للتشغيل)
    this.bufferSource = this.ctx.createBufferSource()
    this.bufferSource.buffer = audioBuffer
    this._connectSource(this.bufferSource)
  }

  /**
   * تشغيل/استئناف — ينشئ BufferSource جديداً دائماً (لا يُعاد استخدامه)
   * ويبدأ من الموضع المحفوظ.
   */
  playBuffer() {
    if (!this._buffer || !this.ctx) return
    const ctx = this.ctx

    // مصدر «مُجهَّز من _loadAudioBuffer ولم يُشغَّل بعد» → نبدأ به مباشرة.
    // مصدر بدأ فعلاً أو انتهى → لا يُعاد استخدامه أبداً (أحادي الاستخدام).
    let source = this.bufferSource
    if (!source || this._sourceStarted) {
      source = ctx.createBufferSource()
      source.buffer = this._buffer
      this._connectSource(source)
      this.bufferSource = source
    }

    const offset = this._playbackOffset % this._buffer.duration
    source.start(0, offset)
    this._sourceStarted = true
    this._startTime = ctx.currentTime

    source.onended = () => {
      // إيقاف يدوي؟ (عولج مسبقاً في stopBuffer و bufferSource = null)
      if (this.bufferSource !== source) return

      this._playbackOffset += ctx.currentTime - this._startTime
      this.bufferSource = null
      this._sourceStarted = false
      try {
        source.disconnect()
      } catch {
        /* لا وصلات */
      }

      if (this._playbackOffset >= this._buffer.duration) {
        this._playbackOffset = 0 // انتهى طبيعياً → يبدأ من البداية لاحقاً
      }
      if (this.onPlaybackEnd) this.onPlaybackEnd()
    }
  }

  /**
   * إيقاف/توقيف — يحفظ الموضع الحالي ثم يوقف المصدر.
   * (الاستئناف لاحقاً يبدأ من نفس الموضع)
   */
  stopBuffer() {
    if (!this.bufferSource) return

    const ctx = this.ctx
    this._playbackOffset += ctx.currentTime - this._startTime
    const src = this.bufferSource
    this.bufferSource = null // أولاً — حتى يتجاهل onended
    this._sourceStarted = false
    try {
      src.stop()
    } catch {
      /* غير مشغّل */
    }
    src.disconnect()
  }

  /* ---------- التحكم ---------- */

  /**
   * isClean = true → «نقي» (بعد التصفية) | false → «الخام» (قبل)
   * يبدّل الـ gains بمنحنى سلس — لا يقطع الصوت أثناء التشغيل.
   */
  toggleBypass(isClean) {
    this.bypassed = !isClean
    const { cleanGain, rawGain } = this.nodes
    if (!cleanGain || !this.ctx) return

    const t = this.ctx.currentTime
    const target = this.bypassed ? 0 : 1
    cleanGain.gain.cancelScheduledValues(t)
    rawGain.gain.cancelScheduledValues(t)
    cleanGain.gain.setTargetAtTime(target, t, BYPASS_RAMP / 3)
    rawGain.gain.setTargetAtTime(1 - target, t, BYPASS_RAMP / 3)
  }

  /* ---------- تصدير WAV (OfflineAudioContext) ---------- */

  /**
   * ينتظر حتى يُرسل الـ worklet رسالة pong بجاهزية RNNoise (أو timeout 10s).
   * OfflineAudioContext يعالج أسرع من الزمن الحقيقي — يجب ألا نبدأ قبل اكتمال
   * تهيئة الـ WASM داخل الـ processor وإلا كان الإخراج صفراً.
   */
  _waitForWorkletReady(node) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 10000)
      node.port.onmessage = (e) => {
        if (e.data && e.data.type === 'pong') {
          clearTimeout(timer)
          resolve(e.data.ready === true)
        }
      }
      node.port.postMessage({ type: 'ping' })
    })
  }

  /**
   * يعالج البافر المرفوع كاملاً عبر السلسلة (بدون Analyser) ثم يعيد العينة
   * إلى 44.1kHz ويعيد Blob بصيغة WAV 16-bit. التصدير دائماً «نقي» (نظيف).
   */
  async exportCleanedWav() {
    if (!this._buffer) throw new Error('لا يوجد ملف صوتي محمّل للتصدير')
    const buffer = this._buffer

    // 1) المعالجة الكاملة @ 48kHz (OfflineAudioContext)
    const offline = new OfflineAudioContext(1, buffer.length, PROCESS_SAMPLE_RATE)
    await offline.audioWorklet.addModule(rnnoiseProcessorUrl)
    const chain = this._buildChain(offline, { withAnalyser: false })

    // التصدير نظيف دائماً
    chain.cleanGain.gain.value = 1
    chain.rawGain.gain.value = 0

    // انتظر اكتمال تهيئة RNNoise قبل بدء المعالجة
    const ready = await this._waitForWorkletReady(chain.rnnoise)
    if (!ready) throw new Error('تعذّرت تهيئة معالج الصوت')

    const source = offline.createBufferSource()
    source.buffer = buffer
    source.connect(chain.highpass)
    source.start(0)
    const processed = await offline.startRendering() // 48kHz mono

    // 2) إعادة العينة إلى 44.1kHz عبر OfflineAudioContext ثانٍ (جودة المتصفح)
    const targetLen = Math.round(
      (processed.length * EXPORT_SAMPLE_RATE) / PROCESS_SAMPLE_RATE,
    )
    const resample = new OfflineAudioContext(1, targetLen, EXPORT_SAMPLE_RATE)
    const src2 = resample.createBufferSource()
    src2.buffer = processed
    src2.connect(resample.destination)
    src2.start(0)
    const final = await resample.startRendering() // 44.1kHz mono

    const blob = audioBufferToWav(final, { sampleRate: EXPORT_SAMPLE_RATE })
    return { blob, duration: final.duration }
  }

  /* ---------- الوصول للفيجوالايزر ---------- */

  getAnalyser() {
    // أثناء التسجيل: فيجوالايزر الميكروفون الحي — بعد ذلك: فيجوالايزر التشغيل
    if (this._recState) return this._recState.micAnalyser
    return this.nodes.analyser || null
  }

  getStream() {
    return this.micStream
  }

  getContext() {
    return this.ctx
  }

  get bufferDuration() {
    return this._buffer ? this._buffer.duration : 0
  }
}
