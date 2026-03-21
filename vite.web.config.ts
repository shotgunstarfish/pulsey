import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Web-only config — no Electron plugin, stays running in browser
export default defineConfig({
  plugins: [react()],
})
