# 🎧 تنظيف الصوت — مزيل الضوضاء الذكي

تطبيق ويب (SPA) لتنظيف الصوت **في الوقت الفعلي** — يزيل ضوضاء الخلفية ويحسّن وضوح الكلام، ويعمل **بالكامل في متصفحك** (صوتك لا يغادر جهازك أبداً).

## ✨ المميزات

- 🎙️ **ميكروفون حي** مع معالجة لحظية (بدون أي رفع للخادم)
- 📁 **سحب وإفلات** ملفات صوتية (MP3 / WAV / M4A / OGG)
- 🔀 **اختبار A/B** فوري: استمع للصوت المنظف مقابل الأصلي بمفتاح واحد
- 💾 **تصدير WAV** نظيف (16-bit · 44.1kHz) بمعالجة كاملة عبر OfflineAudioContext
- 📊 **فيجوالايزر** حي (طيف الترددات) متصل بـ AnalyserNode
- 🛡️ **100% Client-Side**: لا تُرفع أي بيانات لأي خادم

## 🎛️ سلسلة المعالجة

```
المصدر (ميكروفون / ملف)
  → High-Pass Filter (80Hz)           ← قص الهمهمة المنخفضة
  → RNNoise (WASM + AudioWorklet)     ← إلغاء ضوضاء الخلفية
  → Peaking EQ (3.5kHz, +2.5dB, Q:1)  ← حضور الصوت
  → Dynamics Compressor               ← تسوية المستوى (th:-20, knee:10, ratio:4, attack:0.003, release:0.25)
  → Limiter (20:1)                    ← حماية من التشويش
  → Master Gain → السماعات + Analyser
```

## 🛠️ التقنية

| الطبقة | التقنية |
|---|---|
| البناء | **Vite 8** + React 19 (JavaScript) |
| التنسيق | **Tailwind CSS 4** (وضع داكن، RTL، متجاوب) |
| الصوت | Web Audio API (AudioWorklet + AudioNodes) |
| إلغاء الضوضاء | **@jitsi/rnnoise-wasm** (sync build — wasm مضمّن base64) |
| التصدير | OfflineAudioContext (معالجة كاملة) + wavEncoder يدوي (16-bit PCM) |

### ملاحظات WASM (مهمة)

- الـ RNNoise wasm **مضمّن base64** داخل `rnnoise-sync.js` → لا ملفات `.wasm` خارجية، **صفر مخاطرة MIME**.
- الـ AudioWorklet processor يُبنى كـ chunk مستقل (`?worker&url` + `worker.format: 'es'`) ويُحمَّل بـ `new URL(..., import.meta.url)` — مسار نسبي يعمل على أي subpath.
- الـ AudioContext مضبوط على **48kHz** (إطار RNNoise = 480 عينة).
- التصدير ينتج **أحادي (mono)** — RNNoise يعالج قناة واحدة.

## 🚀 التشغيل المحلي

```bash
npm install        # تثبيت الاعتماديات
npm run dev        # خادم تطوير (http://localhost:5173)
npm run build      # بناء إنتاجي — المخرجات في dist/
npm run preview    # معاينة البناء محلياً
```

> يتطلب متصفحاً يدعم **AudioWorklet** (Chrome / Edge أحدث).

## 🌐 النشر على GitHub Pages

البنية جاهزة للنشر التلقائي:

1. ارفع المشروع إلى مستودع GitHub (`git init && git add . && git commit -m "init" && git push`).
2. من إعدادات المستودع: **Settings → Pages → Source: GitHub Actions**.
3. عند كل `push` إلى `main` يشغّل `.github/workflows/deploy.yml` تلقائياً:
   - `npm ci` → `npm run build`
   - **فحص** عدم وجود مسارات جذر مطلقة (`/`) — لأن `base: './'`
   - **فحص** معالجة WASM (application/wasm أو مضمّن base64)
   - رفع `dist/` عبر `upload-pages-artifact@v3` → نشر عبر `deploy-pages@v4`

الموقع النهائي: `https://<username>.github.io/<repo-name>/`

## 📁 بنية المشروع

```
├── .github/workflows/deploy.yml   ← النشر التلقائي
├── public/.nojekyll               ← يمنع Jekyll على GitHub Pages
├── src/
│   ├── audio/
│   │   ├── AudioEngine.js         ← البايبلاين الكامل + تصدير WAV
│   │   ├── rnnoise-processor.worklet.js ← AudioWorkletProcessor
│   │   └── vendor/rnnoise-sync.js ← RNNoise (wasm مضمّن base64)
│   ├── components/Toasts.jsx      ← الإشعارات
│   ├── hooks/useAudioEngine.js    ← حالة React للمحرك
│   ├── utils/wavEncoder.js        ← ترميز WAV 16-bit
│   ├── App.jsx                    ← الواجهة
│   └── main.jsx
├── test/wavEncoder.test.mjs       ← اختبارات وحدة (node test/wavEncoder.test.mjs)
├── index.html
└── vite.config.js                 ← base: './' + worker.format: 'es'
```

صُنع بحب للصوت النظيف 🎙️✨
