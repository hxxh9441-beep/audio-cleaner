import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioEngine } from '../audio/AudioEngine'

/**
 * useAudioEngine — يغلّف AudioEngine بحالة React جاهزة للواجهة
 */
export function useAudioEngine() {
  const engineRef = useRef(null)
  const [isReady, setIsReady] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isClean, setIsClean] = useState(true)
  const [fileName, setFileName] = useState(null)
  const [sourceType, setSourceType] = useState('none') // 'none' | 'upload' | 'recording'
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
    // فحص دعم AudioWorklet + WASM + OfflineAudioContext + MediaRecorder
    const ok =
      typeof AudioContext !== 'undefined' &&
      'audioWorklet' in AudioContext.prototype &&
      typeof OfflineAudioContext !== 'undefined' &&
      typeof WebAssembly !== 'undefined' &&
      typeof MediaRecorder !== 'undefined'
    setSupported(ok)
    if (!ok) setError('متصفحك لا يدعم التسجيل أو المعالجة الصوتية — جرّب Chrome أو Edge أحدث')
    // تهيئة مبكرة (تُنشئ الـ AudioContext عند أول تفاعل — سياسة التشغيل التلقائي)
    getEngine()
      .then((engine) => {
        // كشف للاختبار الآلي/التشخيص — المحرك محلي بالكامل (لا أثر أمني)
        window.__audioEngine = engine
        return engine.ensureContext()
      })
      .then(() => setIsReady(true))
      .catch((e) => setError(String(e.message || e)))
  }, [getEngine])

  const startRecording = useCallback(async () => {
    setError(null)
    try {
      const engine = await getEngine()
      await engine.startRecording()
      setIsRecording(true)
    } catch (e) {
      setError(`تعذّر بدء التسجيل: ${e.message || e}`)
      throw e
    }
  }, [getEngine])

  const stopRecording = useCallback(async () => {
    const engine = await getEngine()
    try {
      const res = await engine.stopRecording()
      setFileName('تسجيل الميكروفون')
      setSourceType('recording')
      setFileDuration(res.duration)
      setIsPlaying(false)
      return res
    } finally {
      // حتى لو فشل (تسجيل قصير جداً) — نخرج من حالة التسجيل في الواجهة
      setIsRecording(false)
    }
  }, [getEngine])

  const loadFile = useCallback(
    async (file) => {
      setError(null)
      try {
        const engine = await getEngine()
        const buf = await engine.loadAudioFile(file)
        setFileName(file.name)
        setSourceType('upload')
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
    // انتهاء الملف طبيعياً → تحديث حالة الواجهة
    engine.onPlaybackEnd = () => setIsPlaying(false)
    engine.playBuffer()
    setIsPlaying(true)
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
    isRecording,
    isPlaying,
    isClean,
    fileName,
    sourceType,
    fileDuration,
    isExporting,
    error,
    supported,
    startRecording,
    stopRecording,
    loadFile,
    play,
    stop,
    setClean,
    exportWav,
    getAnalyser,
  }
}
