/**
 * اختبار وحدة لـ wavEncoder.js — بدون متصفح (AudioBuffer مُحاكى)
 * يشغَّل: node test/wavEncoder.test.mjs
 */
import { audioBufferToWav } from '../src/utils/wavEncoder.js'

// AudioBuffer مُحاكى بسيط
function mockAudioBuffer({ length, sampleRate, channelsData }) {
  return {
    length,
    sampleRate,
    numberOfChannels: channelsData.length,
    getChannelData: (c) => channelsData[c],
  }
}

let pass = 0
let fail = 0
const check = (name, cond) => {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}`)
  }
}

console.log('1) WAV أحادي 16-bit @44100')
{
  const sr = 44100
  const n = 4410 // 0.1 ثانية
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) data[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5
  const buf = mockAudioBuffer({ length: n, sampleRate: sr, channelsData: [data] })
  const blob = audioBufferToWav(buf, { sampleRate: sr })
  const bytes = Buffer.from(await blob.arrayBuffer())

  check('الحجم = 44 + n*2', bytes.length === 44 + n * 2)
  check('RIFF', bytes.toString('ascii', 0, 4) === 'RIFF')
  check('WAVE', bytes.toString('ascii', 8, 12) === 'WAVE')
  check('fmt ', bytes.toString('ascii', 12, 16) === 'fmt ')
  check('PCM = 1', bytes.readUInt16LE(20) === 1)
  check('قناة واحدة', bytes.readUInt16LE(22) === 1)
  check('معدل 44100', bytes.readUInt32LE(24) === 44100)
  check('16-bit', bytes.readUInt16LE(34) === 16)
  check('data', bytes.toString('ascii', 36, 40) === 'data')
  check('حجم البيانات = n*2', bytes.readUInt32LE(40) === n * 2)
  // أعلى عينة (sin يبلغ 0.5 عند i = (1/4 + k) * 44100/440)
  let peak = 0
  for (let i = 0; i < n; i++) {
    const v = bytes.readInt16LE(44 + i * 2)
    if (Math.abs(v) > Math.abs(peak)) peak = v
  }
  check('ذروة 0.5 → ~16383', Math.abs(Math.abs(peak) - 0x4000) < 200)
  // clipping: عينة >1.0
  const clip = mockAudioBuffer({
    length: 2,
    sampleRate: sr,
    channelsData: [new Float32Array([1.5, -1.5])],
  })
  const clipBytes = Buffer.from(await audioBufferToWav(clip, { sampleRate: sr }).arrayBuffer())
  check('قصّ العينات فوق 1.0', clipBytes.readInt16LE(44) === 32767)
  check('قصّ العينات تحت -1.0', clipBytes.readInt16LE(46) === -32768)
}

console.log('2) WAV ستيريو 16-bit')
{
  const sr = 48000
  const n = 480
  const L = new Float32Array(n).fill(0.25)
  const R = new Float32Array(n).fill(-0.25)
  const buf = mockAudioBuffer({ length: n, sampleRate: sr, channelsData: [L, R] })
  const blob = audioBufferToWav(buf, { sampleRate: sr })
  const bytes = Buffer.from(await blob.arrayBuffer())
  check('قناتان', bytes.readUInt16LE(22) === 2)
  check('blockAlign = 4', bytes.readUInt16LE(32) === 4)
  // 0.25 → 0x7FFF*0.25 = 8191.75 → 8191 | -0.25 → 0x8000*-0.25 = -8192
  check('interleave L,R,L,R', bytes.readInt16LE(44) === 8191 && bytes.readInt16LE(46) === -8192)
}

console.log(`\nالنتيجة: ${pass} نجح / ${fail} فشل`)
process.exit(fail ? 1 : 0)
