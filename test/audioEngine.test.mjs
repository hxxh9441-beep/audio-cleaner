/**
 * اختبار وحدة لمنطق التشغيل/الإيقاف في AudioEngine
 * ------------------------------------------------
 * يتحقق من إصلاح Play/Pause: AudioBufferSourceNode أحادي الاستخدام —
 * بعد stop() لا يمكن إعادة تشغيله، لذا يجب إنشاء مصدر جديد مع تتبع الموضع.
 *
 * يشغَّل: node test/audioEngine.test.mjs
 */

/* ---------- محاكاة Web Audio (دقيقة لسلوك المصادر أحادية الاستخدام) ---------- */

// globals مطلوبة قبل استيراد الـ worklet module (يُنفَّذ registerProcessor عند التحميل)
globalThis.registerProcessor = () => {}
globalThis.AudioWorkletProcessor = class {}

// استيراد ديناميكي بعد ضبط الـ globals
const { AudioEngine } = await import('../src/audio/AudioEngine.js')

// AudioWorkletNode غير معرّف في Node
globalThis.AudioWorkletNode = class {
  constructor() {
    this.port = { postMessage() {}, onmessage: null }
  }
  connect() {}
  disconnect() {}
}

const gain = () => ({
  gain: {
    value: 1,
    cancelScheduledValues() {},
    setTargetAtTime(v) {
      this.value = v
    },
  },
  connect() {},
  disconnect() {},
})

const filter = () => ({
  type: '',
  frequency: { value: 0 },
  Q: { value: 0 },
  gain: { value: 0 },
  connect() {},
  disconnect() {},
})

const compressorNode = () => ({
  threshold: { value: 0 },
  knee: { value: 0 },
  ratio: { value: 0 },
  attack: { value: 0 },
  release: { value: 0 },
  connect() {},
  disconnect() {},
})

function createMockContext() {
  let time = 0
  const ctx = {
    destination: {},
    audioWorklet: { addModule: async () => {} },
    get state() {
      return 'running'
    },
    get currentTime() {
      return time
    },
    _advance(sec) {
      time += sec
    },
    resume: async () => {},
    createGain: gain,
    createBiquadFilter: filter,
    createDynamicsCompressor: compressorNode,
    createAnalyser: () => ({
      fftSize: 0,
      smoothingTimeConstant: 0,
      connect() {},
    }),
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createMediaStreamDestination: () => ({
      stream: { id: 'dest-stream' },
      connect() {},
      disconnect() {},
    }),
    createBuffer: () => ({}),
    createBufferSource() {
      const node = {
        buffer: null,
        offset: 0,
        connects: 0,
        connect() {
          this.connects++
        },
        disconnect() {},
        start(when, offset) {
          this.offset = offset
          this.started = true
        },
        stop() {
          // سلوك المتصفح: stop() يُطلق onended
          if (this.onended) this.onended()
        },
      }
      return node
    },
    decodeAudioData: async () => ({
      duration: 2,
      length: 96000,
      sampleRate: 48000,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(0),
    }),
  }
  return ctx
}

/* ---------- الاختبارات ---------- */

let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

function freshEngine() {
  const engine = new AudioEngine()
  const ctx = createMockContext()
  engine.ctx = ctx
  engine.nodes = engine._buildChain(ctx, { withAnalyser: true })
  engine._buffer = { duration: 2, length: 96000, sampleRate: 48000 }
  return { engine, ctx }
}

console.log('1) تشغيل → إيقاف → تشغيل من جديد (جوهر الإصلاح)')
{
  const { engine, ctx } = freshEngine()

  engine.playBuffer()
  const src1 = engine.bufferSource
  check('المصدر الأول اشتغل من 0', src1 && src1.offset === 0)
  check('المصدر الأول وُصل بالمسارين (نظيف + خام)', src1.connects === 2)

  // تشغيل 0.5 ثانية ثم إيقاف
  ctx._advance(0.5)
  engine.stopBuffer()
  check('بعد الإيقاف: bufferSource = null', engine.bufferSource === null)
  check('الموضع محفوظ ≈ 0.5', Math.abs(engine._playbackOffset - 0.5) < 0.001, engine._playbackOffset.toFixed(3))

  // تشغيل مجدد — يجب أن يكون مصدراً جديداً تماماً من الموضع المحفوظ
  engine.playBuffer()
  const src2 = engine.bufferSource
  check('المصدر الثاني جديد (ليس نفسه)', src2 !== src1)
  check('المصدر الثاني بدأ من الموضع المحفوظ ≈ 0.5', Math.abs(src2.offset - 0.5) < 0.001, src2.offset.toFixed(3))
}

console.log('2) إيقاف يدوي لا يصفّر الموضع (onended يتجاهل الإيقاف اليدوي)')
{
  const { engine, ctx } = freshEngine()
  let endedCalls = 0
  engine.onPlaybackEnd = () => endedCalls++

  engine.playBuffer()
  const src = engine.bufferSource
  ctx._advance(0.3)
  engine.stopBuffer() // stop() يُطلق onended في المحاكاة
  check('onPlaybackEnd لم يُستدعَ عند إيقاف يدوي', endedCalls === 0)
  check('الموضع 0.3 محفوظ (لم يُصفَّر)', Math.abs(engine._playbackOffset - 0.3) < 0.001)
}

console.log('3) النهاية الطبيعية: تصفير الموضع + استدعاء onPlaybackEnd')
{
  const { engine, ctx } = freshEngine()
  let endedCalls = 0
  engine.onPlaybackEnd = () => endedCalls++

  engine.playBuffer()
  const src = engine.bufferSource
  // الوصول لنهاية الملف (المدة 2 ثانية)
  ctx._advance(2.0)
  src.onended() // المتصفح يستدعيها عند بلوغ النهاية
  check('bufferSource = null بعد النهاية', engine.bufferSource === null)
  check('الموضع صُفّر (0)', engine._playbackOffset === 0)
  check('onPlaybackEnd استُدعي مرة', endedCalls === 1)

  // تشغيل بعد النهاية — يبدأ من البداية
  engine.playBuffer()
  check('بعد النهاية: تشغيل جديد من 0', engine.bufferSource && engine.bufferSource.offset === 0)
}

console.log('4) التبديل بين نقي/الخام أثناء التشغيل — عبر gains فقط (لا انقطاع)')
{
  const { engine } = freshEngine()
  engine.playBuffer()
  const src = engine.bufferSource

  engine.toggleBypass(false) // → الخام
  check('bypassed = true', engine.bypassed === true)
  check('cleanGain → 0', engine.nodes.cleanGain.gain.value === 0)
  check('rawGain → 1', engine.nodes.rawGain.gain.value === 1)
  check('المصدر ما زال مشغّلاً (لم يُفصل/يوقف)', engine.bufferSource === src && src.connects === 2)

  engine.toggleBypass(true) // → نقي
  check('cleanGain → 1', engine.nodes.cleanGain.gain.value === 1)
  check('rawGain → 0', engine.nodes.rawGain.gain.value === 0)
  check('المصدر ما زال مشغّلاً بعد التبديلين', engine.bufferSource === src)
}

console.log('5) ملف جديد يصفّر الموضع')
{
  const { engine, ctx } = freshEngine()
  engine.playBuffer()
  ctx._advance(0.7)
  engine.stopBuffer()
  check('الموضع قبل ملف جديد = 0.7', Math.abs(engine._playbackOffset - 0.7) < 0.001)

  const file = { arrayBuffer: async () => new ArrayBuffer(0), name: 'a.wav' }
  await engine.loadAudioFile(file)
  check('ملف جديد → الموضع 0', engine._playbackOffset === 0)
}

console.log('6) التسجيل الحي — لا ارتجاع صوتي + حقن في مساحة العمل')
{
  // محاكاة MediaRecorder
  globalThis.MediaRecorder = class {
    static isTypeSupported() {
      return true
    }
    constructor(stream, opts) {
      this.stream = stream
      this.mimeType = (opts && opts.mimeType) || 'audio/webm'
      this.ondataavailable = null
      this.onstop = null
      this.onerror = null
    }
    start() {
      this.started = true
    }
    stop() {
      if (this.ondataavailable)
        this.ondataavailable({ data: new Blob(['fake-audio'], { type: this.mimeType }) })
      if (this.onstop) this.onstop()
    }
  }

  // محاكاة الميكروفون
  let micStopped = false
  const fakeStream = {
    getTracks: () => [{ stop: () => (micStopped = true) }],
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getUserMedia: async () => fakeStream } },
    configurable: true,
    writable: true,
  })

  const { engine, ctx } = freshEngine()
  // تتبع وصلات مصدر الميكروفون (يُركَّب قبل startRecording)
  ctx.createMediaStreamSource = () => {
    const node = {
      connects: 0,
      targets: [],
      connect(t) {
        this.connects++
        this.targets.push(t)
      },
      disconnect() {},
    }
    return node
  }

  await engine.startRecording()
  const rec = engine._recState
  check('بدء التسجيل: MediaRecorder يعمل', rec && rec.recorder.started === true)
  const src = rec.micSource
  check('الميكروفون يتصل بوجهتين فقط (analyser + وجهة التسجيل)', src.connects === 2, `${src.connects}`)
  check('يتصل بالفيجوالايزر الحي', src.targets.includes(rec.micAnalyser))
  check('يتصل بوجهة التسجيل (MediaStreamDestination)', src.targets.includes(rec.recDest))
  check(
    'لا يتصل بالسماعات (ctx.destination / master) إطلاقاً',
    !src.targets.includes(ctx.destination) && !src.targets.includes(engine.nodes.master),
  )
  check(
    'لا يمر عبر سلسلة المعالجة (highpass/rawGain)',
    !src.targets.includes(engine.nodes.highpass) && !src.targets.includes(engine.nodes.rawGain),
  )
  check('الفيجوالايزر أثناء التسجيل = فيجوالايزر الميكروفون', engine.getAnalyser() === rec.micAnalyser)

  // إيقاف التسجيل وحفظه
  const res = await engine.stopRecording()
  check('الإيقاف: أعاد blob + مدة', res && res.blob && res.duration === 2)
  check('التسجيل حُقن في مساحة العمل (_buffer)', engine._buffer !== null)
  check('الموضع صُفّر (0) — جاهز للتشغيل من البداية', engine._playbackOffset === 0)
  check('مصدر جاهز للتشغيل (bufferSource)', engine.bufferSource !== null)
  check('الميكروفون توقف (getTracks().stop)', micStopped === true)
  check('لا تسجيل نشط بعد الإيقاف', engine.isRecording() === false)
  check('الفيجوالايزر عاد لفيجوالايزر التشغيل', engine.getAnalyser() === engine.nodes.analyser)

  // تشغيل التسجيل المحفوظ — نفس مسار الملف المرفوع
  engine.playBuffer()
  check(
    'تشغيل التسجيل: المصدر بُدئ فعلاً من 0',
    engine.bufferSource && engine.bufferSource.started === true && engine.bufferSource.offset === 0,
  )
  engine.toggleBypass(false)
  check('تبديل «الخام» يعمل على التسجيل (gains فقط)', engine.nodes.rawGain.gain.value === 1)
}

console.log('7) عند غياب MediaRecorder — خطأ واضح بدل انهيار صامت')
{
  const { engine } = freshEngine()
  const SavedMR = globalThis.MediaRecorder
  delete globalThis.MediaRecorder
  let threw = false
  let msg = ''
  try {
    await engine.startRecording()
  } catch (e) {
    threw = true
    msg = e.message
  }
  check('startRecording رمى خطأً', threw)
  check('الرسالة توضح الدعم', /لا يدعم التسجيل/.test(msg), msg)
  globalThis.MediaRecorder = SavedMR
}

console.log('8) تشغيل بعد تحميل ملف/تسجيل — لا early-return (المصدر المُجهَّز يُبدأ فعلاً)')
{
  const { engine, ctx } = freshEngine()
  // محاكاة تحميل ملف (يُجهّز مصدراً بدون start)
  const file = { arrayBuffer: async () => new ArrayBuffer(0), name: 'a.wav' }
  await engine.loadAudioFile(file)
  const prepared = engine.bufferSource
  check('بعد التحميل: مصدر مُجهَّز', prepared !== null)
  check('المصدر المُجهَّز لم يبدأ بعد', prepared.started !== true)

  engine.playBuffer()
  check(
    'playBuffer بدأ المصدر المُجهَّز (لا early-return)',
    engine.bufferSource === prepared && prepared.started === true && prepared.offset === 0,
  )

  // إيقاف ثم تشغيل مجدد → مصدر جديد يبدأ من الموضع المحفوظ
  ctx._advance(0.4)
  engine.stopBuffer()
  engine.playBuffer()
  const second = engine.bufferSource
  check('بعد الإيقاف: مصدر جديد بدأ فعلاً', second !== prepared && second.started === true)
  check('بدأ من الموضع المحفوظ ≈ 0.4', Math.abs(second.offset - 0.4) < 0.001)
}

console.log(`\nالنتيجة: ${pass} نجح / ${fail} فشل`)
process.exit(fail ? 1 : 0)
