import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The login/upload/campaign API (server/) runs as a separate Node
    // process in dev (started alongside Vite by `npm run dev`); this lets
    // the frontend call same-origin `/api/...` paths either way.
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
})
