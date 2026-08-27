import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import * as cesiumPluginModule from 'vite-plugin-cesium'

// vite-plugin-cesium's package.json/.d.ts pairing confuses tsc's nodenext
// default-import resolution (it statically types the default export as the
// whole module rather than the function), even though the real export is
// correct at runtime. Reaching in with a type assertion sidesteps that
// false-positive without disabling type-checking project-wide.
const cesiumPlugin = (cesiumPluginModule as unknown as { default: () => Plugin }).default;

// https://vite.dev/config/
export default defineConfig({
  // vite-plugin-cesium copies Cesium's static assets (workers, widgets CSS)
  // into the build and sets window.CESIUM_BASE_URL automatically — Cesium
  // can't locate them on its own under Vite's dev/build pipeline.
  plugins: [react(), cesiumPlugin()],
  // maplibre-gl ships an internal web worker; Vite's esbuild-based dep
  // optimizer mishandles it (see maplibre-gl-worker.mjs errors in the dev
  // log), which silently kills all vector tile parsing. Excluding it here
  // makes Vite serve the package as-is instead of pre-bundling it.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
})
