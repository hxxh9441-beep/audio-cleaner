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

        // خلفية شبكية خفيفة
        ctx2d.strokeStyle = 'rgba(148,163,184,0.08)'
        ctx2d.lineWidth = 1
        for (let x = 0; x < W; x += 24) {
          ctx2d.beginPath()
          ctx2d.moveTo(x, 0)
          ctx2d.lineTo(x, H)
          ctx2d.stroke()
        }
        for (let y = 0; y < H; y += 24) {
          ctx2d.beginPath()
          ctx2d.moveTo(0, y)
          ctx2d.lineTo(W, y)
          ctx2d.stroke()
        }

        const grad = ctx2d.createLinearGradient(0, H, 0, 0)
        grad.addColorStop(0, '#0284c7')
        grad.addColorStop(0.5, '#22d3ee')
        grad.addColorStop(1, '#a7f3d0')

        const bars = 64
        const step = Math.floor(bins.length / bars)
        const bw = W / bars
        const isLive = isActive

        for (let i = 0; i < bars; i++) {
          const v = bins[i * step] / 255
          const bh = Math.max(isLive ? 2 : 1, v * H)
          ctx2d.fillStyle = grad
          ctx2d.globalAlpha = 0.55 + v * 0.45
          ctx2d.fillRect(i * bw + 1, H - bh, bw - 2, bh)
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
      aria-label="الفيجوالايزر — طيف الصوت الحي"
      className="h-44 w-full rounded-2xl border border-slate-700/60 bg-slate-900/60"
    />
  )
}

/* ---------------- منطقة السحب والإفلات ---------------- */
function DragDropZone({ onFile, fileName, fileDuration, disabled }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      setDragging(false)
      const f = e.dataTransfer.files && e.dataTransfer.files[0]
      if (f) onFile(f)
    },
    [onFile],
  )

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      inputRef.current && inputRef.current.click()
    }
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="رفع ملف صوتي — اسحب الملف هنا أو اضغط للاختيار"
      onClick={() => !disabled && inputRef.current && inputRef.current.click()}
      onKeyDown={onKeyDown}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`group cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
        dragging
          ? 'border-cyan-400 bg-cyan-500/10'
          : 'border-slate-700 bg-slate-900/40 hover:border-cyan-500/50 hover:bg-slate-900/70'
      } ${disabled ? 'pointer-events-none opacity-40' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files && e.target.files[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
      {fileName ? (
        <div>
          <div className="text-2xl">🎵</div>
          <div className="mt-1 truncate text-sm font-bold text-cyan-300">{fileName}</div>
          <div className="mt-1 text-xs text-slate-400">
            {fileDuration ? `${fileDuration.toFixed(1)} ثانية` : '—'} · اضغط لاستبدال الملف
          </div>
        </div>
      ) : (
        <div>
          <div className="text-2xl">📁</div>
          <div className="mt-1 text-sm font-semibold text-slate-200">
            اسحب ملف صوتي هنا أو اضغط للاختيار
          </div>
          <div className="mt-1 text-xs text-slate-500">MP3 · WAV · M4A · OGG</div>
        </div>
      )}
    </div>
  )
}

/* ---------------- مفتاح المقارنة A/B ---------------- */
function ComparisonSwitch({ isClean, onChange, disabled }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-900/40 px-4 py-3">
      <span className="text-lg">🔀</span>
      <div className="flex flex-1 flex-col">
        <span className="text-xs font-bold text-slate-300">اختبار A/B</span>
        <span className="text-[11px] text-slate-500">
          {isClean ? 'تسمع الصوت المنظف' : 'تسمع الصوت الأصلي'}
        </span>
      </div>
      <button
        role="switch"
        aria-checked={isClean}
        aria-label={isClean ? 'التنظيف مفعّل — اضغط للاستماع للأصلي' : 'التنظيف متوقف — اضغط للاستماع للمنظف'}
        onClick={() => onChange(!isClean)}
        disabled={disabled}
        className={`relative h-8 w-14 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-40 ${
          isClean ? 'bg-cyan-600' : 'bg-amber-600'
        }`}
      >
        <span
          className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${
            isClean ? 'right-1' : 'right-7'
          }`}
        />
      </button>
      <div className="flex flex-col items-end text-[11px]">
        <span className={isClean ? 'font-bold text-cyan-300' : 'text-slate-500'}>
          ✨ المنظف
        </span>
        <span className={!isClean ? 'font-bold text-amber-300' : 'text-slate-500'}>
          🎚️ الأصلي
        </span>
      </div>
    </div>
  )
}

/* ---------------- بطاقة عقدة معالجة ---------------- */
function NodeCard({ icon, title, desc, active }) {
  return (
    <div
      className={`rounded-xl border p-3 text-right transition ${
        active
          ? 'border-cyan-500/50 bg-cyan-500/10'
          : 'border-slate-700/60 bg-slate-900/40 opacity-50'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <span className="text-sm font-semibold text-slate-100">{title}</span>
        <span
          className={`mr-auto h-2 w-2 rounded-full ${
            active ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-slate-600'
          }`}
        />
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{desc}</p>
    </div>
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

  const pushToast = useCallback((type, msg) => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, type, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }, [])

  const dismissToast = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const handleFile = useCallback(
    async (f) => {
      if (!f) return
      if (!/audio\//.test(f.type) && !/\.(mp3|wav|m4a|ogg|aac|flac)$/i.test(f.name)) {
        pushToast('error', 'الملف ليس صوتياً — ارفع MP3 أو WAV أو صيغة صوتية أخرى')
        return
      }
      try {
        await loadFile(f)
        pushToast('success', `تم تحميل «${f.name}» — جاهز للتنظيف`)
      } catch {
        pushToast('error', 'تعذّر قراءة الملف — تأكد أنه بصيغة صوتية سليمة')
      }
    },
    [loadFile, pushToast],
  )

  const handleMic = useCallback(async () => {
    if (isMicOn) {
      await stopMic()
      pushToast('info', 'تم إيقاف الميكروفون')
    } else {
      try {
        await startMic()
        pushToast('success', 'الميكروفون يعمل — التنظيف في الوقت الفعلي مفعّل')
      } catch {
        pushToast('error', 'تعذّر الوصول للميكروفون — تحقق من الإذن')
      }
    }
  }, [isMicOn, startMic, stopMic, pushToast])

  const handlePlay = useCallback(async () => {
    if (!fileName) {
      pushToast('info', 'ارفع ملفاً صوتياً أولاً للتشغيل')
      return
    }
    if (isPlaying) {
      await stop()
    } else {
      await play()
      pushToast('info', isClean ? 'تشغيل الصوت المنظف ✨' : 'تشغيل الصوت الأصلي 🎚️')
    }
  }, [fileName, isPlaying, isClean, play, stop, pushToast])

  const handleExport = useCallback(async () => {
    if (!fileName) {
      pushToast('info', 'ارفع ملفاً صوتياً أولاً للتصدير')
      return
    }
    try {
      const { duration } = await exportWav()
      pushToast(
        'success',
        `تم تنزيل WAV نظيف (44.1kHz · ${duration.toFixed(1)} ثانية) — cleaned-audio-*.wav`,
      )
    } catch {
      pushToast('error', 'فشل التصدير — جرّب ملفاً أقصر أو متصفحاً أحدث')
    }
  }, [fileName, exportWav, pushToast])

  // تمرير الأخطاء من الـ hook إلى الـ toasts
  useEffect(() => {
    if (error) pushToast('error', error)
  }, [error, pushToast])

  return (
    <div dir="rtl" className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* الترويسة */}
        <header className="mb-6 flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-right">
          <div>
            <h1 className="text-3xl font-bold">
              🎧 تنظيف الصوت
              <span className="mt-1 block text-sm font-normal text-cyan-400">
                مزيل الضوضاء الذكي — في الوقت الفعلي
              </span>
            </h1>
          </div>
          <div
            title="100% Client-Side: Your audio never leaves your device"
            className="flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300"
          >
            <span className="text-base">🛡️</span>
            <span dir="ltr">100% Client-Side</span>
            <span className="hidden text-emerald-400/80 sm:inline">—</span>
            <span className="hidden sm:inline">صوتك لا يغادر جهازك أبداً</span>
          </div>
        </header>

        {!supported && (
          <div className="mb-4 rounded-xl border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-200">
            ⚠️ متصفحك لا يدعم AudioWorklet — استخدم Chrome أو Edge أحدث لتجربة كاملة
          </div>
        )}

        {/* الشبكة الرئيسية */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* العمود الرئيسي */}
          <div className="space-y-4 lg:col-span-2">
            <Visualizer getAnalyser={getAnalyser} isActive={isMicOn || isPlaying} />

            <DragDropZone
              onFile={handleFile}
              fileName={fileName}
              fileDuration={fileDuration}
              disabled={!supported}
            />

            <ComparisonSwitch
              isClean={isClean}
              onChange={setClean}
              disabled={!supported}
            />

            {/* أزرار التحكم */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <button
                onClick={handleMic}
                disabled={!supported}
                aria-pressed={isMicOn}
                className={`relative rounded-xl px-4 py-3 text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-40 ${
                  isMicOn
                    ? 'bg-rose-600 text-white hover:bg-rose-500'
                    : 'bg-cyan-600 text-white hover:bg-cyan-500'
                }`}
              >
                {isMicOn && (
                  <span className="absolute -top-1 -left-1 flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-500" />
                  </span>
                )}
                {isMicOn ? '🛑 إيقاف الميكروفون' : '🎙️ تشغيل الميكروفون'}
              </button>

              <button
                onClick={handlePlay}
                disabled={!supported || !fileName}
                className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isPlaying ? '⏹️ إيقاف' : '▶️ تشغيل'}
              </button>

              <button
                onClick={handleExport}
                disabled={!supported || !fileName || isExporting}
                className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-violet-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isExporting ? '⏳ جاري التنظيف...' : '💾 تصدير WAV'}
              </button>

              <div className="flex items-center justify-center rounded-xl border border-slate-800 bg-slate-900/40 text-xs text-slate-400">
                {isReady ? (
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                    المحرك جاهز
                  </span>
                ) : (
                  <span className="animate-pulse">◌ جاري التهيئة...</span>
                )}
              </div>
            </div>
          </div>

          {/* العمود الجانبي — سلسلة المعالجة */}
          <div className="space-y-2">
            <h2 className="text-sm font-bold text-slate-300">
              سلسلة المعالجة{' '}
              {!isClean && (
                <span className="text-amber-400">— (متجاوزة — مرور خام)</span>
              )}
            </h2>
            <NodeCard
              icon="🎚️"
              title="مرشح High-Pass"
              desc="قص الهمهمة المنخفضة — 80Hz"
              active={isClean}
            />
            <NodeCard
              icon="🧹"
              title="RNNoise"
              desc="إلغاء ضوضاء الخلفية لحظياً (WASM)"
              active={isClean}
            />
            <NodeCard
              icon="🎛️"
              title="Peaking EQ"
              desc="حضور الصوت — 3.5kHz، +2.5dB"
              active={isClean}
            />
            <NodeCard
              icon="📊"
              title="Compressor"
              desc="تسوية المستوى — ratio 4:1"
              active={isClean}
            />
            <NodeCard
              icon="🛡️"
              title="Limiter"
              desc="حماية من التشويش — 20:1"
              active={isClean}
            />
            <NodeCard
              icon="🔊"
              title="Master Gain"
              desc="المستوى النهائي للإخراج"
              active={true}
            />
            {fileName && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-[11px] leading-relaxed text-slate-500">
                💡 التصدير يعالج الملف كاملاً عبر OfflineAudioContext ثم يحوّله إلى{' '}
                <span dir="ltr">WAV 16-bit · 44.1kHz</span> (أحادي — لأن RNNoise يعالج
                قناة واحدة).
              </div>
            )}
          </div>
        </div>

        <footer className="mt-8 text-center text-xs text-slate-600">
          يعمل بالكامل محلياً في متصفحك — لا تُرفع أي بيانات لخادم · Web Audio API +
          RNNoise WASM
        </footer>
      </div>

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
