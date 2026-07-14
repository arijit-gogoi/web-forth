import { defineConfig } from 'vite'
import { foldkit } from '@foldkit/vite-plugin'

// web-forth client (SPEC.md §T.14). Standalone Foldkit SPA. The foldkit plugin handles
// the JSX-free html DSL + runtime wiring. server.fs.allow reaches up to the workspace
// root so the linked @web-forth/engine source resolves in dev.
export default defineConfig({
  plugins: [foldkit()],
  server: {
    fs: {
      allow: ['../../'],
    },
  },
})
