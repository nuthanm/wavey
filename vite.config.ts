import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { waveyApiPlugin } from './scripts/vite-wavey-api.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), waveyApiPlugin()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
