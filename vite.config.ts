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
    // video/ is the walkthrough tooling, not app code. Recording writes
    // thousands of frame images into video/.rec/ — watching them kept Vite
    // busy enough to starve the browser being recorded (capture fell from
    // ~11 fps to 1-2 fps).
    watch: {
      ignored: ['**/video/**'],
    },
  },
})
