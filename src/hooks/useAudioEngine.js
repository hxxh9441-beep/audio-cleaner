import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioEngine } from '../audio/AudioEngine'

/**
 * useAudioEngine — يغلّف AudioEngine بحالة React جاهزة للواجهة
 */
export function useAudioEngine() {
  const engineRef = useRef(null)
  const [isReady, setIsReady] = useState(false)
  const [isMicOn, setIsMicOn] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isClean, setIsClean] = useState(true)
  const [fileName, setFileName] = useState(null)
  const [fileDuration, setFileDuration] = useState(0)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState(null)
  const [supported, setSupported] = useState(true)

  const getEngine = useCallback(async () => {
    if (!engineRef.current) {
      engineRef.current = new AudioEngine()
    }
    return engineRef.current
  }, [])

  useEffect(() => {
    // فحص دعم AudioWorklet + WASM + OfflineAudioContext
    const ok =
      typeof AudioContext !== 'undefined' &&
      'audioWorklet' in AudioContext.prototype &&
      typeof OfflineAudioContext !== 'undefined' &&
      typeof WebAssembly !== 'undefined'
    setSupported(ok)
    if (!ok) setError('متصفحك لا يدعم AudioWorklet — جرّب Chrome أو Edge أحدث')
    // تهيئة مبكرة (تُنشئ الـ AudioContext عند أول تفاعل — سياسة التشغيل التلقائي)
    getEngine()
      .then((engine) => engine.ensureContext())
      .then(() => setIsReady(true))
      .catch((e) => setError(String(e.message || e)))
  }, [getEngine])

  const startMic = useCallback(async () => {
    setError(null)
    try {
      const engine = await getEngine()
      await engine.startMic()
      setIsMicOn(true)
    } catch (e) {
      setError(`تعذّر تشغيل الميكروفون: ${e.message || e}`)
      throw e
    }
  }, [getEngine])

  const stopMic = useCallback(async () => {
    const engine = await getEngine()
    engine.stopMic()
    setIsMicOn(false)
  }, [getEngine])

  const loadFile = useCallback(
    async (file) => {
      setError(null)
      try {
        const engine = await getEngine()
        const buf = await engine.loadAudioFile(file)
        setFileName(file.name)
        setFileDuration(buf.duration)
        setIsPlaying(false)
        return buf
      } catch (e) {
        setError(`تعذّر قراءة الملف: ${e.message || e}`)
        throw e
      }
    },
    [getEngine],
  )

  const play = useCallback(async () => {
    const engine = await getEngine()
    engine.playBuffer()
    setIsPlaying(true)
    const src = engine.bufferSource
    if (src) {
      src.onended = () => setIsPlaying(false)
    }
  }, [getEngine])

  const stop = useCallback(async () => {
    const engine = await getEngine()
    engine.stopBuffer()
    setIsPlaying(false)
  }, [getEngine])

  const setClean = useCallback(
    async (clean) => {
      const engine = await getEngine()
      engine.toggleBypass(clean)
      setIsClean(clean)
    },
    [getEngine],
  )

  const exportWav = useCallback(async () => {
    setIsExporting(true)
    setError(null)
    try {
      const engine = await getEngine()
      const { blob, duration } = await engine.exportCleanedWav()

      // تنزيل مباشر من المتصفح
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const date = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `cleaned-audio-${date}.wav`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)

      return { blob, duration, url }
    } catch (e) {
      const msg = `تعذّر التصدير: ${e.message || e}`
      setError(msg)
      throw new Error(msg)
    } finally {
      setIsExporting(false)
    }
  }, [getEngine])

  const getAnalyser = useCallback(async () => {
    const engine = await getEngine()
    return engine.getAnalyser()
  }, [getEngine])

  return {
    isReady,
    isMicOn,
    isPlaying,
    isClean,
    fileName,
    fileDuration,
    isExporting,
    error,
    supported,
    startMic,
    stopMic,
    loadFile,
    play,
    stop,
    setClean,
    exportWav,
    getAnalyser,
  }
}
