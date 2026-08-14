import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * InstallPrompt — شريط تثبيت التطبيق (PWA)
 * -----------------------------------------
 * - Android/Chromium: يستمع لحدث beforeinstallprompt ويظهر شريطاً سفلياً
 *   بزر «تثبيت» + زر إغلاق (يُحفظ التجاهل في localStorage).
 * - iOS Safari: يظهر دليلاً سفلياً لإضافة التطبيق للصفحة الرئيسية مع زر إغلاق.
 */
const DISMISS_KEY = 'pwa-install-dismissed'

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone

export default function InstallPrompt() {
  const [mode, setMode] = useState(null) // 'android' | 'ios' | null
  const deferredPrompt = useRef(null)

  useEffect(() => {
    // تجاهل بعد أول إغلاق/تثبيت
    if (localStorage.getItem(DISMISS_KEY)) return

    if (isIOS()) {
      setMode('ios')
      return
    }

    const onBeforeInstall = (e) => {
      e.preventDefault()
      deferredPrompt.current = e
      setMode('android')
    }
    const onInstalled = () => {
      localStorage.setItem(DISMISS_KEY, '1')
      setMode(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, '1')
    setMode(null)
  }, [])

  const install = useCallback(async () => {
    const prompt = deferredPrompt.current
    if (!prompt) return
    prompt.prompt()
    try {
      await prompt.userChoice
    } catch {
      /* المستخدم ألغى أو تعذّر */
    }
    localStorage.setItem(DISMISS_KEY, '1')
    setMode(null)
  }, [])

  if (!mode) return null

  return (
    <div
      role="dialog"
      aria-label={mode === 'ios' ? 'طريقة تثبيت التطبيق على الآيفون' : 'تثبيت التطبيق'}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-slate-900/95 p-4 shadow-[0_-8px_30px_rgba(0,0,0,0.5)] backdrop-blur"
    >
      <div className="mx-auto flex max-w-xl items-center gap-3">
        {mode === 'android' ? (
          <>
            <img
              src="icons/icon-192.png"
              alt=""
              className="h-12 w-12 shrink-0 rounded-xl border border-white/10"
            />
            <div className="flex-1 text-sm">
              <div className="font-bold text-slate-100">تثبيت التطبيق على جهازك</div>
              <div className="mt-0.5 text-xs text-slate-400">
                نقاء الصوت — يعمل بدون إنترنت بعد التثبيت
              </div>
            </div>
            <button
              onClick={install}
              className="shrink-0 rounded-full bg-gradient-to-l from-cyan-500 to-emerald-500 px-5 py-2 text-sm font-bold text-white shadow-lg shadow-cyan-500/25 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            >
              تثبيت
            </button>
            <button
              onClick={dismiss}
              aria-label="إغلاق"
              className="shrink-0 rounded-full p-2 text-slate-400 transition hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            >
              ✕
            </button>
          </>
        ) : (
          <>
            <div className="flex-1 text-sm leading-relaxed">
              <div className="font-bold text-slate-100">لتثبيت التطبيق على الآيفون:</div>
              <p className="mt-1 text-slate-300">
                اضغط زر المشاركة{' '}
                <span className="inline-flex items-center gap-1 rounded-md bg-white/10 px-1.5 py-0.5 align-middle text-xs font-semibold text-slate-200">
                  ⎋ مشاركة
                </span>{' '}
                ثم اختر{' '}
                <span className="font-bold text-cyan-300">إضافة إلى الصفحة الرئيسية ➕</span>
              </p>
            </div>
            <button
              onClick={dismiss}
              aria-label="إغلاق"
              className="shrink-0 rounded-full p-2 text-slate-400 transition hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            >
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  )
}
