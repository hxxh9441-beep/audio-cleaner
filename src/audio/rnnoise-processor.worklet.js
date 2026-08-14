/**
 * RNNoise AudioWorkletProcessor
 * -----------------------------
 * يعالج الصوت إطاراً بإطار (480 عينة @ 48kHz) عبر rnnoise-wasm (sync build
 * مع wasm مضمّن base64 — لا يحتاج fetch خارجي داخل الـ worklet).
 *
 * الاستيراد: rnnoise-sync.js منسوخ محلياً إلى vendor/ للتحكم الكامل بالمسار.
 * ملاحظة: AudioContext يُنشأ بـ sampleRate: 48000 ليطابق إطار RNNoise.
 */
import createRNNWasmModuleSync from './vendor/rnnoise-sync.js'

const FRAME_SIZE = 480 // إطار RNNoise القياسي @ 48kHz
const QUANTUM = 128 // render quantum في AudioWorklet
const QUEUE_LEN = FRAME_SIZE * 4 // مخزن إخراج دائري (معدل ثابت → آمن)

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._ready = false
    this._state = 0
    this._inputPtr = 0
    this._outputPtr = 0

    // تجميع الإدخال حتى اكتمال إطار 480
    this._inputAccum = new Float32Array(FRAME_SIZE)
    this._inputFill = 0

    // مخزن إخراج دائري
    this._outputQueue = new Float32Array(QUEUE_LEN)
    this._outputHead = 0
    this._outputFill = 0

    // يسمح للمين ثريد بانتظار اكتمال التهيئة قبل بدء المعالجة
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'ping') {
        this.port.postMessage({ type: 'pong', ready: this._ready })
      }
    }

    this._init()
  }

  async _init() {
    try {
      const mod = await createRNNWasmModuleSync()
      this._mod = mod
      this._state = mod._rnnoise_create()
      this._inputPtr = mod._malloc(FRAME_SIZE * 4)
      this._outputPtr = mod._malloc(FRAME_SIZE * 4)
      this._ready = true
      this.port.postMessage({ type: 'status', ready: true })
    } catch (err) {
      console.error('[rnnoise-worklet] init failed:', err)
      this.port.postMessage({ type: 'status', ready: false, error: String(err) })
    }
  }

  process(inputs, outputs) {
    // 1) إخراج ما هو جاهز (أو صمت) — دائماً
    const outChan = outputs[0] && outputs[0][0]
    if (outChan) {
      const take = Math.min(QUANTUM, this._outputFill)
      for (let i = 0; i < take; i++) {
        outChan[i] = this._outputQueue[(this._outputHead + i) % QUEUE_LEN]
      }
      for (let i = take; i < QUANTUM; i++) outChan[i] = 0
      this._outputHead = (this._outputHead + take) % QUEUE_LEN
      this._outputFill -= take
    }

    if (!this._ready || !this._state) return true

    const inChan = inputs[0] && inputs[0][0]
    if (!inChan) return true

    // 2) تجميع إدخال الكوانتوم (128) حتى اكتمال إطار (480) ثم معالجته
    let src = 0
    while (src < QUANTUM) {
      const need = FRAME_SIZE - this._inputFill
      const take = Math.min(need, QUANTUM - src)
      this._inputAccum.set(inChan.subarray(src, src + take), this._inputFill)
      this._inputFill += take
      src += take

      if (this._inputFill === FRAME_SIZE) {
        // معالجة الإطار عبر rnnoise — لاحظ الترتيب: (state, out, in)
        this._mod.HEAPF32.set(this._inputAccum, this._inputPtr >> 2)
        this._mod._rnnoise_process_frame(this._state, this._outputPtr, this._inputPtr)
        const clean = new Float32Array(
          this._mod.HEAPF32.buffer,
          this._outputPtr,
          FRAME_SIZE,
        )
        // إلحاق الناتج بذيل المخزن الدائري
        const tail = (this._outputHead + this._outputFill) % QUEUE_LEN
        for (let i = 0; i < FRAME_SIZE; i++) {
          this._outputQueue[(tail + i) % QUEUE_LEN] = clean[i]
        }
        this._outputFill += FRAME_SIZE
        this._inputFill = 0
      }
    }
    return true
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor)
