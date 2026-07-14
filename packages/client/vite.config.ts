import { defineConfig } from 'vite'
import { foldkit } from '@foldkit/vite-plugin'

// web-forth client (SPEC.md §T.14). Standalone Foldkit SPA. The foldkit plugin handles
// the JSX-free html DSL + runtime wiring. server.fs.allow reaches up to the workspace
// root so the linked @web-forth/engine source resolves in dev.
//
// base: the production build ships to GitHub Pages at /web-forth/, so assets must be
// prefixed with that subpath (a root-relative /assets/... would 404 under the project
// page). Dev keeps base '/' so the local server serves from the root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/web-forth/' : '/',
  plugins: [foldkit()],
  server: {
    fs: {
      allow: ['../../'],
    },
  },
}))
