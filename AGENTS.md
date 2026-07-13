# AGENTS.md

Web-Forth: an **authentic indirect-threaded (ITC) Forth** with a browser REPL.

- **Engine**: TypeScript. Real fig-Forth structure — flat `Int32Array` memory (dictionary + code + data space), data + return stacks, `HERE`/`IP` registers, `DOCOL`/`EXIT`, indirect-threaded inner interpreter (`NEXT`). Genuine `@ ! , c@ c! here allot`, `EXECUTE`, `CREATE`/`DOES>`.
- **Effects**: [Effect](https://effect.website) v4. Typed errors (`StackUnderflow`, `UndefinedWord`, …) as tagged errors; the VM is an `Effect.Service`. Effect is used at the **outer-interpreter / top-level EXECUTE boundary only** — never inside the `NEXT` loop (per-instruction Effect = death).
- **UI**: [Foldkit](https://foldkit.dev) — Elm Architecture (one immutable Model, one `update`). The Model holds **UI state + read-only snapshots** of the stack/dictionary for display; the mutable VM memory lives **outside** the Model behind the Effect seam.

## Vendored source — READ-ONLY reference

`repos/` contains vendored upstream source, embedded via `git subtree`:

- `repos/effect-smol/` — Effect **v4** source (v4 lives in the `effect-smol` repo; the `effect` npm package `@beta` tag).
- `repos/foldkit/` — Foldkit source.

**Rules for agents:**

- Treat everything under `repos/` as **read-only reference material**. Do not edit it.
- When unsure of an Effect v4 or Foldkit API, **read the vendored source** — prefer real examples and signatures from `repos/**` over generated guesses or stale training memory.
- `repos/` is excluded from the app build (`tsconfig.json` `exclude`). Do not import app code from it.

To refresh a vendored repo:

```bash
git subtree pull --prefix=repos/effect-smol https://github.com/Effect-TS/effect-smol.git main --squash
git subtree pull --prefix=repos/foldkit      https://github.com/foldkit/foldkit.git      main --squash
```
