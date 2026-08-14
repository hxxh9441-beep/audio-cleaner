import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioEngine } from './hooks/useAudioEngine.js'
import Toasts from './components/Toasts.jsx'

/* ---------------- الفيجوالايزر ---------------- */
function Visualizer({ getAnalyser, isActive }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    let raf = 0
    const canvas = canvasRef.current
    const ctx2d = canvas.getContext('2d')

    const draw = async () => {
      const analyser = await getAnalyser()
      if (analyser) {
        const W = (canvas.width = canvas.clientWidth)
        const H = (canvas.height = canvas.clientHeight)
        const bins = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(bins)

        ctx2d.clearRect(0, 0, W, H)

        const grad = ctx2d.createLinearGradient(0, H, 0, 0)
        grad.addColorStop(0, 'rgba(34,211,238,0.5)')
        grad.addColorStop(1, 'rgba(167,243,208,0.9)')

        const bars = 48
        const step = Math.floor(bins.length / bars)
        const bw = W / bars

        for (let i = 0; i < bars; i++) {
          const v = bins[i * step] / 255
          const bh = Math.max(isActive ? 3 : 1.5, v * H)
          ctx2d.fillStyle = grad
          ctx2d.globalAlpha = 0.35 + v * 0.65
          ctx2d.beginPath()
          ctx2d.roundRect(i * bw + 2, H - bh, bw - 4, bh, 4)
          ctx2d.fill()
        }
        ctx2d.globalAlpha = 1
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [getAnalyser, isActive])

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="موجة الصوت"
      className="h-32 w-full rounded-2xl border border-white/5 bg-white/[0.03]"
    />
  )
}

/* ---------------- التطبيق ---------------- */
export default function App() {
  const {
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
  } = useAudioEngine()

  const [toasts, setToasts] = useState([])
  const toastId = useRef(0)
  const [tab, setTab] = useState('mic') // 'mic' | 'upload'
  const [micSeconds, setMicSeconds] = useState(0)
  const [dragging, setDragging] = useState(false)
  const workspaceRef = useRef(null)
  const fileInputRef = useRef(null)

  const pushToast = useCallback((type, msg) => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, type, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }, [])

  const dismissToast = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  // مؤقت التسجيل
  useEffect(() => {
    if (!isMicOn) return
    setMicSeconds(0)
    const t = setInterval(() => setMicSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [isMicOn])

  const fmtTime = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const handleMic = useCallback(async () => {
    if (isMicOn) {
      await stopMic()
      pushToast('info', 'تم إيقاف التسجيل')
    } else {
      try {
        await startMic()
        pushToast('success', 'التسجيل يعمل — استمع للفرق الآن')
      } catch {
        pushToast('error', 'تعذّر الوصول للميكروفون — تحقق من الإذن')
      }
    }
  }, [isMicOn, startMic, stopMic, pushToast])

  const handleFile = useCallback(
    async (f) => {
      if (!f) return
      if (!/audio\//.test(f.type) && !/\.(mp3|wav|m4a|ogg|aac|flac)$/i.test(f.name)) {
        pushToast('error', 'الملف ليس صوتياً — ارفع MP3 أو WAV أو M4A')
        return
      }
      try {
        await loadFile(f)
        pushToast('success', 'تم تحميل الملف — جاهز للتنقية')
      } catch {
        pushToast('error', 'تعذّرت قراءة الملف — تأكد أنه سليم')
      }
    },
    [loadFile, pushToast],
  )

  const switchTab = useCallback(
    async (next) => {
      if (next === tab) return
      // إيقاف الميكروفون عند الانتقال لتبويب الرفع
      if (next === 'upload' && isMicOn) {
        await stopMic()
      }
      setTab(next)
    },
    [tab, isMicOn, stopMic],
  )

  const handlePlay = useCallback(async () => {
    if (!fileName) {
      pushToast('info', tab === 'upload' ? 'ارفع ملفاً صوتياً أولاً' : 'حوّل لتبويب رفع الملف')
      return
    }
    if (isPlaying) await stop()
    else await play()
  }, [fileName, isPlaying, tab, play, stop, pushToast])

  const handleExport = useCallback(async () => {
    if (!fileName) {
      pushToast('info', 'ارفع ملفاً صوتياً أولاً')
      return
    }
    try {
      const { duration } = await exportWav()
      pushToast('success', `تم تنزيل الصوت المنقّى — ${duration.toFixed(1)} ثانية`)
    } catch {
      pushToast('error', 'تعذّر التنزيل — جرّب مرة أخرى')
    }
  }, [fileName, exportWav, pushToast])

  // تمرير الأخطاء من الـ hook إلى الـ toasts
  useEffect(() => {
    if (error) pushToast('error', error)
  }, [error, pushToast])

  const scrollToWorkspace = () => {
    workspaceRef.current && workspaceRef.current.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div dir="rtl" className="min-h-screen bg-slate-950 text-slate-100 antialiased">
      {/* ============ Hero ============ */}
      <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center">
        {/* خلفية متدرجة ناعمة */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 right-1/4 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="absolute bottom-0 left-1/4 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-slate-950" />
        </div>

        <div className="relative max-w-2xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm text-slate-300 backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" />
            يعمل الآن — جاهز للاستخدام
          </div>

          <h1 className="text-5xl font-black leading-tight tracking-tight sm:text-6xl">
            نقاء{' '}
            <span className="bg-gradient-to-l from-cyan-300 to-emerald-300 bg-clip-text text-transparent">
              الصوت
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-slate-400">
            تخلص من ضجيج المكيفات والأصوات المحيطة في تسجيلاتك
            <span className="text-slate-200"> بنقرة واحدة</span>
          </p>

          <button
            onClick={scrollToWorkspace}
            className="mt-10 rounded-full bg-gradient-to-l from-cyan-500 to-emerald-500 px-10 py-4 text-lg font-bold text-white shadow-lg shadow-cyan-500/25 transition hover:scale-105 hover:shadow-xl hover:shadow-cyan-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 active:scale-95"
          >
            ابدأ الآن
          </button>

          <p className="mt-6 text-sm text-slate-600">بدون تسجيل · بدون تحميلات · مجاني تماماً</p>
        </div>
      </section>

      {/* ============ Workspace ============ */}
      <section ref={workspaceRef} className="px-4 pb-24">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6 shadow-2xl shadow-black/40 backdrop-blur sm:p-8">
            {/* التبويبات */}
            <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-slate-950/60 p-1.5">
              <button
                onClick={() => switchTab('mic')}
                aria-pressed={tab === 'mic'}
                className={`rounded-xl px-4 py-3 text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
                  tab === 'mic'
                    ? 'bg-gradient-to-l from-cyan-500 to-emerald-500 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                🎙️ تسجيل صوتي مباشر
              </button>
              <button
                onClick={() => switchTab('upload')}
                aria-pressed={tab === 'upload'}
                className={`rounded-xl px-4 py-3 text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
                  tab === 'upload'
                    ? 'bg-gradient-to-l from-cyan-500 to-emerald-500 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                📁 رفع ملف صوتي
              </button>
            </div>

            {/* ===== تبويب التسجيل ===== */}
            {tab === 'mic' && (
              <div className="flex flex-col items-center py-4">
                <button
                  onClick={handleMic}
                  disabled={!supported}
                  className={`relative flex h-28 w-28 items-center justify-center rounded-full text-white transition focus:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-40 ${
                    isMicOn
                      ? 'bg-rose-600 shadow-lg shadow-rose-600/40 hover:bg-rose-500'
                      : 'bg-gradient-to-br from-cyan-500 to-emerald-500 shadow-lg shadow-cyan-500/30 hover:scale-105 active:scale-95'
                  }`}
                >
                  {isMicOn && (
                    <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-rose-500/40" />
                  )}
                  <span className="text-3xl">{isMicOn ? '🛑' : '🎙️'}</span>
                </button>

                <div className="mt-4 text-center">
                  <div
                    className={`font-mono text-2xl font-bold tabular-nums ${
                      isMicOn ? 'text-rose-400' : 'text-slate-300'
                    }`}
                  >
                    {fmtTime(micSeconds)}
                  </div>
                  <p className="mt-2 text-sm text-slate-400">
                    {isMicOn
                      ? 'التنقية تعمل الآن — استمع للفرق لحظياً'
                      : 'اضغط الزر وابدأ التحدث — تُنقّى الخلفية لحظياً'}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    لتجربة التنزيل، استخدم تبويب «رفع ملف صوتي»
                  </p>
                </div>
              </div>
            )}

            {/* ===== تبويب الرفع ===== */}
            {tab === 'upload' && (
              <div className="py-2">
                <div
                  role="button"
                  tabIndex={supported ? 0 : -1}
                  aria-label="رفع ملف صوتي — اسحب الملف هنا أو اضغط للاختيار"
                  onClick={() => supported && fileInputRef.current && fileInputRef.current.click()}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && supported) {
                      e.preventDefault()
                      fileInputRef.current && fileInputRef.current.click()
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragging(false)
                    const f = e.dataTransfer.files && e.dataTransfer.files[0]
                    if (f) handleFile(f)
                  }}
                  className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-10 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
                    dragging
                      ? 'border-cyan-400 bg-cyan-500/10'
                      : 'border-white/10 bg-white/[0.02] hover:border-cyan-500/40'
                  } ${supported ? '' : 'pointer-events-none opacity-40'}`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files && e.target.files[0]
                      if (f) handleFile(f)
                      e.target.value = ''
                    }}
                  />
                  {fileName ? (
                    <div>
                      <div className="text-3xl">🎵</div>
                      <div className="mt-2 truncate text-sm font-bold text-cyan-300">
                        {fileName}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {fileDuration ? `${fileDuration.toFixed(1)} ثانية` : ''} · اضغط لاستبدال الملف
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-3xl">📁</div>
                      <div className="mt-2 text-sm font-semibold text-slate-200">
                        اسحب الملف هنا أو اضغط للاختيار
                      </div>
                      <div className="mt-1 text-xs text-slate-500">MP3 · WAV · M4A</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* الفيجوالايزر */}
            <div className="mt-6">
              <Visualizer getAnalyser={getAnalyser} isActive={isMicOn || isPlaying} />
            </div>

            {/* التشغيل والمقارنة */}
            <div className="mt-6 flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
              <button
                onClick={handlePlay}
                disabled={!supported || !fileName}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-xl text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={isPlaying ? 'إيقاف' : 'تشغيل'}
              >
                {isPlaying ? '⏸️' : '▶️'}
              </button>

              <div className="flex items-center gap-1 rounded-full bg-slate-950/60 p-1.5">
                <button
                  onClick={() => setClean(false)}
                  aria-pressed={!isClean}
                  className={`rounded-full px-5 py-2 text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
                    !isClean
                      ? 'bg-amber-500/90 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  الخام <span className="text-xs opacity-70">(قبل)</span>
                </button>
                <button
                  onClick={() => setClean(true)}
                  aria-pressed={isClean}
                  className={`rounded-full px-5 py-2 text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
                    isClean
                      ? 'bg-gradient-to-l from-cyan-500 to-emerald-500 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  نقي <span className="text-xs opacity-70">(بعد التصفية)</span>
                </button>
              </div>
            </div>

            {/* زر التحميل — في تبويب الرفع فقط */}
            {tab === 'upload' && (
              <button
                onClick={handleExport}
                disabled={!supported || !fileName || isExporting}
                className="mt-6 w-full rounded-2xl bg-gradient-to-l from-cyan-500 to-emerald-500 px-6 py-4 text-base font-bold text-white shadow-lg shadow-cyan-500/25 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isExporting ? '⏳ جاري التنقية...' : '⬇️ تحميل الصوت المنقّى'}
              </button>
            )}
          </div>

          {/* حالة الجاهزية (صامتة) */}
          <p className="mt-4 text-center text-xs text-slate-700">
            {isReady ? '✓ جاهز للعمل' : '◌ جاري التجهيز...'}
          </p>
        </div>
      </section>

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
