/**
 * audioBufferToWav — يحوّل AudioBuffer إلى ملف WAV (PCM 16-bit) خفيف بلا اعتماديات
 */
export function audioBufferToWav(buffer, { sampleRate = 44100 } = {}) {
  const numChannels = Math.min(2, buffer.numberOfChannels)
  const length = buffer.length
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const dataSize = length * blockAlign
  const arrayBuffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(arrayBuffer)

  const writeString = (v, offset, str) => {
    for (let i = 0; i < str.length; i++) v.setUint8(offset + i, str.charCodeAt(i))
  }

  // رأس RIFF/WAVE
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // حجم كتلة fmt
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // 16-bit
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  const channels = []
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c))

  let offset = 44
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]))
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      offset += 2
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' })
}
