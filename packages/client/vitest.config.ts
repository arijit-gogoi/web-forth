import { defineConfig } from 'vitest/config'

// web-forth client tests (SPEC.md §T.14). happy-dom for the Scene DOM harness; the
// foldkit test setup registers its custom matchers/environment. foldkit is inlined so
// its ESM is transformed by vitest.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/vitest-setup.ts'],
    server: {
      deps: {
        inline: ['foldkit'],
      },
    },
  },
})
