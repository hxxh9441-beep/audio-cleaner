/**
 * AudioEngine — بايبلاين تنظيف الصوت في الوقت الفعلي + تصدير WAV
 * ---------------------------------------------------------------
 * سلسلة المعالجة:
 *   المصدر (ميكروفون / ملف صوتي)
 *     → High-Pass Filter (80Hz)
 *     → RNNoise AudioWorklet (إلغاء ضوضاء الخلفية)
 *     → Peaking EQ (3.5kHz, +2.5dB, Q: 1.0)
 *     → Dynamics Compressor (threshold: -20, knee: 10, ratio: 4, attack: 0.003, release: 0.25)
 *     → Limiter (حماية من التشويش)
 *     → Master Gain
 *     → الوجهة (السماعات) + Analyser (للفيجوالايزر)
 *
 * Bypass (Original): عند إيقاف التنظيف، يُمرَّر المصدر مباشرة إلى Master دون معالجة.
 * التصدير: يعالج البافر كاملاً عبر OfflineAudioContext ثم يعيد العينة إلى 44.1kHz.
 */
import rnnoiseProcessorUrl from './rnnoise-processor.worklet.js?worker&url'
import { audioBufferToWav } from '../utils/wavEncoder.js'

export const PROCESS_SAMPLE_RATE = 48000 // إطار RNNoise = 480 عينة @ 48kHz
export const EXPORT_SAMPLE_RATE = 44100

export class AudioEngine {
  constructor() {
    this.ctx = null
    this.bypassed = false

    this.nodes = {}

    this.micStream = null
    this._micSource = null

    this.bufferSource = null
    this._buffer = null
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

    // الوصل
    highpass.connect(rnnoise)
    rnnoise.connect(peaking)
    peaking.connect(compressor)
    compressor.connect(limiter)
    limiter.connect(master)
    master.connect(ctx.destination)

    const chain = { highpass, rnnoise, peaking, compressor, limiter, master }

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

  /** يوصّل مصدراً بالسلسلة (أو مباشرة للماستر عند الـ Original/Bypass) */
  _connectSource(source) {
    try {
      source.disconnect()
    } catch {
      /* لا وصلات سابقة */
    }
    if (this.bypassed) {
      source.connect(this.nodes.master)
    } else {
      source.connect(this.nodes.highpass)
    }
  }

  /* ---------- الميكروفون ---------- */

  async startMic() {
    const ctx = await this.ensureContext()
    if (this._micSource) return

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // نعطّل معالجة المتصفح المدمجة — نطبق معالجتنا بدل ذلك
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
    this.micStream = stream
    this._micSource = ctx.createMediaStreamSource(stream)
    this._connectSource(this._micSource)
  }

  stopMic() {
    if (this._micSource) {
      this._micSource.disconnect()
      this._micSource = null
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop())
      this.micStream = null
    }
  }

  /* ---------- ملف صوتي ---------- */

  async loadAudioFile(file) {
    const ctx = await this.ensureContext()
    this.stopBuffer()

    const arrayBuffer = await file.arrayBuffer()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)

    const source = ctx.createBufferSource()
    source.buffer = audioBuffer
    this.bufferSource = source
    this._buffer = audioBuffer

    this._connectSource(source)
    return audioBuffer
  }

  playBuffer() {
    if (this.bufferSource) this.bufferSource.start()
  }

  stopBuffer() {
    if (this.bufferSource) {
      try {
        this.bufferSource.stop()
      } catch {
        /* غير مشغّل */
      }
      this.bufferSource.disconnect()
      this.bufferSource = null
    }
  }

  /* ---------- التحكم ---------- */

  /** isClean = true → التنظيف مفعّل (Cleaned) | false → مرور خام (Original) */
  toggleBypass(isClean) {
    this.bypassed = !isClean
    if (this._micSource) this._connectSource(this._micSource)
    if (this.bufferSource) this._connectSource(this.bufferSource)
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
   * إلى 44.1kHz ويعيد Blob بصيغة WAV 16-bit.
   */
  async exportCleanedWav() {
    if (!this._buffer) throw new Error('لا يوجد ملف صوتي محمّل للتصدير')
    const buffer = this._buffer

    // 1) المعالجة الكاملة @ 48kHz (OfflineAudioContext)
    const offline = new OfflineAudioContext(
      1,
      buffer.length,
      PROCESS_SAMPLE_RATE,
    )
    await offline.audioWorklet.addModule(rnnoiseProcessorUrl)
    const chain = this._buildChain(offline, { withAnalyser: false })

    // انتظر اكتمال تهيئة RNNoise داخل الـ worklet قبل بدء المعالجة
    // (وإلا يبدأ render قبل الجاهزية ويُخرج صفراً — Offline يسبق real-time)
    const ready = await this._waitForWorkletReady(chain.rnnoise)
    if (!ready) throw new Error('تعذّرت تهيئة RNNoise داخل الـ worklet')

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
