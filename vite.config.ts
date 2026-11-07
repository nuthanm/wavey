import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // When API runs via `vercel dev` on :3000 and Vite on :5173
    proxy: {
      '/api': {
        target: process.env.WAVEY_API_PROXY || 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
