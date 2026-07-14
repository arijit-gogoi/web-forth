# AGENTS.md

Web-Forth: an **authentic indirect-threaded (ITC) Forth** with a browser REPL.

- **Engine**: TypeScript. Real fig-Forth structure — flat `Int32Array` memory (dictionary + code + data space), data + return stacks, `HERE`/`IP` registers, `DOCOL`/`EXIT`, indirect-threaded inner interpreter (`NEXT`). Genuine `@ ! , c@ c! here allot`, `EXECUTE`, `CREATE`/`DOES>`.
- **Effects**: [Effect](https://effect.website) v4. The VM is an `Effect.Service`; Effect is used at the **outer-interpreter / top-level EXECUTE boundary only**, never inside the `NEXT` loop (per-instruction Effect = death). Forth errors use authentic `THROW`/`CATCH` (integer codes) and ride the success channel as `RunResult` data; only genuine VM faults (`ForthFault`) hit the Effect E-channel. See `specs/02-engine-design.md`.
- **UI**: [Foldkit](https://foldkit.dev) — Elm Architecture (one immutable Model, one `update`). The Model holds **UI state + read-only snapshots** of the stack/dictionary for display; the mutable VM memory lives **outside** the Model behind the Effect seam. The **editor pane is CodeMirror 6** (itself TEA-shaped: immutable `EditorState`, transactions/`StateEffect`, `EditorView` projection), embedded as an imperative `EditorView` behind a Foldkit `Mount`/`ManagedResource`.

## Vendored source — READ-ONLY reference

`repos/` contains vendored upstream source, embedded via `git subtree`:

- `repos/effect-smol/` — Effect **v4** source (v4 lives in the `effect-smol` repo; the `effect` npm package `@beta` tag).
- `repos/foldkit/` — Foldkit source.
- `repos/codemirror/{state,view,commands,language}/` — CodeMirror 6 source (the editor; `@codemirror/*` packages).

**Rules for agents:**

- Treat everything under `repos/` as **read-only reference material**. Do not edit it.
- When unsure of an Effect v4, Foldkit, or CodeMirror 6 API, **read the vendored source** — prefer real examples and signatures from `repos/**` over generated guesses or stale training memory.
- `repos/` is excluded from the app build (`tsconfig.json` `exclude`). Do not import app code from it.

To refresh a vendored repo:

```bash
git subtree pull --prefix=repos/effect-smol https://github.com/Effect-TS/effect-smol.git main --squash
git subtree pull --prefix=repos/foldkit      https://github.com/foldkit/foldkit.git      main --squash
git subtree pull --prefix=repos/codemirror/state    https://github.com/codemirror/state.git    main --squash
git subtree pull --prefix=repos/codemirror/view     https://github.com/codemirror/view.git     main --squash
git subtree pull --prefix=repos/codemirror/commands https://github.com/codemirror/commands.git main --squash
git subtree pull --prefix=repos/codemirror/language https://github.com/codemirror/language.git main --squash
```

---

<!-- fallow:setup-hooks:start -->
## Fallow local gate

Before any `git commit` or `git push`, run `fallow audit --format json --quiet --explain`. If the verdict is `fail`, fix the reported findings before retrying. Treat JSON runtime errors like `{ "error": true, ... }` as non-blocking.

Audit defaults to `gate=new-only`: only findings introduced by the current changeset affect the verdict. Inherited findings on touched files are reported under `attribution` and annotated with `introduced: false`, but do not block the commit. Set `[audit] gate = "all"` in `fallow.toml` to gate every finding in changed files.
<!-- fallow:setup-hooks:end -->
