// Codegen: packages/engine/src/prelude.fth -> src/prelude.generated.ts (SPEC §T.10).
//
// The prelude is authored as a .fth file (source of truth) and embedded into a .ts
// module (`export const PRELUDE`) at build time. This loads identically in node
// (cli / vitest) and the browser, avoiding Vite-only `?raw` which would break the
// node cli (§C, review BLOCK B-1).
//
// Run via `pnpm --filter @web-forth/engine gen:prelude`, and automatically before
// build / test (see package.json scripts).

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, '..', 'src')
const input = join(srcDir, 'prelude.fth')
const output = join(srcDir, 'prelude.generated.ts')

const forth = readFileSync(input, 'utf8')

// Embed as a JSON string literal: safe for quotes, backslashes, and newlines.
const literal = JSON.stringify(forth)

const banner =
  '// GENERATED from prelude.fth by scripts/gen-prelude.mjs. Do not edit by hand.\n' +
  '// Regenerate with: pnpm --filter @web-forth/engine gen:prelude\n'

writeFileSync(output, `${banner}export const PRELUDE = ${literal}\n`, 'utf8')

console.log(`gen-prelude: wrote ${output} (${forth.length} bytes of Forth)`)
