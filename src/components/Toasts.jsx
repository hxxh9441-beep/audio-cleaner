/**
 * Toasts — إشعارات خفيفة تظهر وتختفي تلقائياً (نجاح / خطأ / معلومات)
 */
export default function Toasts({ toasts, onDismiss }) {
  if (!toasts.length) return null

  const styles = {
    success: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100',
    error: 'border-rose-500/50 bg-rose-500/15 text-rose-100',
    info: 'border-cyan-500/50 bg-cyan-500/15 text-cyan-100',
  }

  const icons = { success: '✅', error: '⚠️', info: 'ℹ️' }

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-4 z-50 flex w-72 flex-col gap-2"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={`pointer-events-auto flex items-start gap-2 rounded-xl border p-3 text-right text-xs shadow-lg backdrop-blur transition hover:opacity-80 ${styles[t.type]}`}
        >
          <span className="text-sm">{icons[t.type]}</span>
          <span className="flex-1 leading-relaxed">{t.msg}</span>
        </button>
      ))}
    </div>
  )
}
