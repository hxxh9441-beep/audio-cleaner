import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base: './' — مسارات نسبية حتى يعمل المشروع على أي subpath في GitHub Pages
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  // AudioWorklet (addModule) يتطلب module script — وليس IIFE
  worker: {
    format: 'es',
  },
  build: {
    target: 'chrome110',
  },
})
