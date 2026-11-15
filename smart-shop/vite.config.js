import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const ortWasm = fileURLToPath(
  new URL('./node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs', import.meta.url),
)

export default defineConfig({
  base: '/ai/',

  plugins: [
    react(),
    tailwindcss(),
  ],

  resolve: {
    alias: {
      'onnxruntime-web/wasm': ortWasm,
      'onnxruntime-web': ortWasm,
    },
    dedupe: ['onnxruntime-web'],
  },

  optimizeDeps: {
    include: ['@ricky0123/vad-web', 'onnxruntime-web'],
  },

  server: {
    proxy: {
      '/livekit-ai': {
        target: 'https://apis.chqme.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/livekit-ai/, '/cde/livekit'),
      },
      '/cart/api': {
        target: 'https://d2capis.chqme.com',
        changeOrigin: true,
      },
      '/cart/chqme-login': {
        target: 'https://d2capis.chqme.com',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: ['smartshop.chqme.com'],
    proxy: {
      '/livekit-ai': {
        target: 'https://apis.chqme.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/livekit-ai/, '/cde/livekit'),
      },
      '/cart/api': {
        target: 'https://d2capis.chqme.com',
        changeOrigin: true,
      },
      '/cart/chqme-login': {
        target: 'https://d2capis.chqme.com',
        changeOrigin: true,
      },
    },
  },
})
