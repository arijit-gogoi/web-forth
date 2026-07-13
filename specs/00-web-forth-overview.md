# web-forth — overview (pre-spec draft)

> Draft. Feeds `/ck:grill` and `/ck:spec`. Section tags in **[§?]** mark where each item should land in the eventual root `SPEC.md`.

## Vision **[§G]**

An **authentic Forth** that runs in the browser with an interactive REPL — inspired by [easyforth](https://skilldrick.github.io/easyforth/), but not a closure-toy: a **real indirect-threaded (ITC) virtual machine** with genuine memory cells, two stacks, an inner interpreter, and `CREATE`/`DOES>`. Educational value = you can see how Forth *actually* works, not a JS-function-per-word simulation.

UI = **split editor + console**: a code editor pane, a console/output pane, plus live views of the data stack and dictionary.

## Locked decisions **[§C]**

Decided in discussion (2026-07-13):

| Area | Decision | Notes |
|------|----------|-------|
| Fidelity | **Authentic threaded Forth** | Real inner interpreter, threaded code, `CREATE`/`DOES>`, memory cells. Not the easyforth closure approach. |
| Threading | **Indirect-threaded (ITC)** | Flat `Int32Array` memory; code fields hold routine indices; `DOCOL`/`EXIT`. Enables genuine `@ ! , here allot`, `>BODY`, `EXECUTE`, `CREATE`/`DOES>`. |
| UI | **Split editor + console** | Editor pane + console + stack view + dictionary view. |
| Language | **TypeScript** (strict, TS `^6.0.3`) | Match Foldkit. |
| Effect system | **Effect v4**, pinned **`4.0.0-beta.88`** | Version **dictated by Foldkit's `peerDependencies`** — `foldkit@0.128.0` (latest npm release, == vendored `main`) declares `effect: 4.0.0-beta.88` + `@effect/platform-browser: 4.0.0-beta.88`. Do **not** bump independently of Foldkit. Source lives in the `effect-smol` repo. |
| UI framework | **Foldkit `0.128.0`** | Elm Architecture: Model / Message / Command / Subscription / Mount. Apps use `@foldkit/vite-plugin`; `create-foldkit-app` scaffolds. |
| Editor | **CodeMirror 6** via Foldkit **`Mount.defineStream`** | Packages `@codemirror/{state,view,commands,language}`, vendored to `repos/codemirror/`. CM6 is TEA-shaped (immutable `EditorState`, transactions, `EditorView` projection). The imperative `EditorView` lives in a module registry (out of the Model); edits and a Mod-Enter keymap emit Messages. Full patterns: `specs/01-foldkit-patterns.md`. |
| Repo shape | **Monorepo of packages** | pnpm workspaces (`packages/*`). |
| Runtime / PM | **Node + pnpm** | Mirror Foldkit: `pnpm@11.8.0`, node `>=20.19 || >=22.12`. |
| Test runner | **Vitest `^4.1.9`** via **`@effect/vitest@4.0.0-beta.88`** | Effect-aware. DOM tests via **`happy-dom`**. Foldkit exposes a `foldkit/test/vitest` entry. |
| Build | **Vite 8** + `@foldkit/vite-plugin` | Match Foldkit toolchain. |

## The seam — VM (mutable) vs Foldkit (immutable) **[§I][§V]**

Core tension: authentic Forth state is a **big mutable `Int32Array`** (memory + stacks + `HERE` + `IP`); Foldkit mandates **one immutable Model copied every update**, with **all side effects confined to Commands** (Elm Architecture — verified in Foldkit's `CLAUDE.md`). Resolution:

- **Foldkit Model = UI state + read-only snapshots only** — editor text, console lines, history, `STATE` (interpret/compile), and *display copies* of the stack + dictionary. The Model **never** holds VM memory.
- **VM lives outside the Model**, behind an **Effect service** (mutable core inside).
- **Run flow is a Command.** A `PressedRun` / `SubmittedInput` **Message** makes `update` return `[Model, Command]`; the Command is an **Effect** that executes the source against the `Vm` service, then yields follow-up **Messages** (`CompletedRun` / `FailedRun`) carrying output + a fresh stack/dict snapshot, which fold into the Model. Errors become Messages via `Effect.catch`, never crash the app.
- **[§V] Invariant:** Effect is used only at the **outer-interpreter / top-level `EXECUTE` boundary** (inside the Command). The **inner `NEXT` loop is a plain `while` over the `Int32Array`** with a JS dispatch table — never per-instruction Effect. Errors escape the inner loop via sentinel/throw caught at the Command's Effect boundary.
- **[§V] Invariant:** Mutable handles never enter the Model. `EditorView` (CM6) and `Vm` live outside the Schema Model. `EditorView` sits in a module-level registry keyed by `hostId` (the Model holds only `Option<hostId>`); `Vm` is an Effect service in the Command `R` channel. Only Schema **snapshots** cross into the Model via Messages, and the data-stack snapshot is a **copied `ReadonlyArray<number>`**, never the live `Int32Array`.

*(Editor bridge resolved: **CodeMirror 6** via **`Mount.defineStream`**. The imperative `EditorView` is constructed on the mount node; `updateListener` + `keymap` emit `ChangedSource` / `PressedRun`; `view.destroy()` on cleanup. External content is pushed in by a Command that dispatches a CM6 transaction to the registry-held view, never by re-mounting. Full patterns and citations: `specs/01-foldkit-patterns.md`; the `map` example is the vendored template.)*

## VM design **[§I]**

- **Memory:** one flat `Int32Array` (or `DataView` over `ArrayBuffer`) = dictionary + code + data space. `HERE` pointer. 32-bit cells. Byte- or cell-addressed (decide in spec).
- **Stacks:** data stack + return stack, each a region/typed-array with `SP`/`RSP`.
- **Inner interpreter (`NEXT`):** `IP` fetches next cell (an execution token / CFA), `IP++`, dispatch. Colon word → `DOCOL` (push `IP` to return stack, set `IP` to body). Primitive → JS routine. `EXIT` pops return stack into `IP`.
- **Outer interpreter:** parse whitespace-delimited token → dictionary lookup → `EXECUTE` or compile; else parse as number; else `word ?` error. `STATE` = interpret vs compile.
- **Immediate words:** `IF ELSE THEN`, `BEGIN UNTIL`, `DO LOOP`, `: ; [ ]` run at compile time, emit branch cells, back-patch offsets.
- **Dictionary:** linked headers (name + flags + code field + params), newest-first for shadowing. `IMMEDIATE` flag.
- **`CREATE`/`DOES>`:** crown jewel — `CREATE` builds a header whose default behavior pushes PFA; `DOES>` rewrites the last word's code field to run the `DOES>` thread after pushing PFA. ITC makes this clean. **v2** (structure now, implement after v1).

### Errors **[§I]**

Authentic `THROW`/`CATCH` with integer codes (`-1` ABORT, `-3`/`-4` stack over/underflow, `-8` dict overflow, `-10` div-by-zero, `-13` undefined word). The outer interpreter (`QUIT`) catches, prints, `ABORT`s (clears the data stack), and continues. **Ordinary Forth errors ride the success channel as data** (`RunResult { output, throwCode }`); the Effect **E-channel (`ForthFault`) is reserved for genuine VM faults**. Full model + codes: `specs/02-engine-design.md`.

## Proposed package layout **[§I]** (draft — confirm in spec)

```
packages/
  engine/     # pure VM: memory, stacks, inner (NEXT/DOCOL/EXIT), dict, outer, errors, prelude. No Foldkit dep.
  ui/         # Foldkit app: Model/Message/update/view, editor + console + stack/dict panes; @foldkit/vite-plugin.
  (repl/?)    # optional headless node CLI over engine, for testing without the browser.
```

`ui` depends on `engine`. The `Vm` Effect service can live in `engine` or a thin adapter consumed by `ui`'s Run Command.

## v1 word-set **[§T]**

- Arithmetic/logic: `+ - * / mod = < > and or not`
- Stack: `dup drop swap over rot`
- I/O: `. .s emit cr`
- Compile: `: ;` (+ `[ ]`)
- Control flow (immediate): `if else then`, `begin until`, `do loop`
- Return stack: `>r r>`
- Memory (authentic): `@ ! c@ c! here allot ,` — `variable constant`

**v2:** `CREATE`/`DOES>`, `>BODY`, `does>`, `i j`, `+loop`, `?do`, `r@`, `[COMPILE] POSTPONE IMMEDIATE`, strings, `BASE`.

## Foldkit conventions **[§C]**

The `ui` package follows Foldkit idioms (enforced by Foldkit's lint + review): Schema-typed Model, verb-past-tense Messages (`PressedKey`, `CompletedRun`), Commands verb-first (`RunSource`), `Match`/`M.tagsExhaustive` over `switch`, `Array<T>` (never `T[]`), no bracket indexing (`Array.get`/`Array.head`), `Option` for absence, no em dashes in prose. Full rules: `repos/foldkit/CLAUDE.md` + the local `.claude/skills/effect-ts` skill. Read those before writing `ui` code.

## Open questions (park for grill/spec) **[§?]**

1. Cell addressing: byte offsets vs cell indices for `@ ! , here allot`?
2. ~~Foldkit effect-dispatch mechanism~~ — **Resolved: side effects are Commands** (`update` returns `[Model, Command]`; Command = Effect yielding Messages).
3. Memory size / growth: fixed `Int32Array` size, or growable?
4. Number bases (`BASE`, hex `$`)? v1 decimal only?
5. ~~Editor bridge~~. **Resolved: CodeMirror 6 via `Mount.defineStream`** (registry-held `EditorView`, snapshot-copy rule). See `specs/01-foldkit-patterns.md`. Remaining sub-detail: a Forth syntax-highlighting mode (`@codemirror/language` `StreamLanguage`), deferred to v2.
6. Prelude: which words are bootstrapped **in Forth itself** vs primitives in TS?
7. Persistence: save/load session or definitions?

## Vendored reference

`repos/effect-smol/` (Effect v4 source; see `ai-docs/`, `LLMS.md`, `packages/effect`, `packages/atom`, `packages/platform-browser`, `packages/vitest`), `repos/foldkit/` (`examples/`, `packages/foldkit`, `packages/create-foldkit-app`, `packages/vite-plugin-foldkit`, and its own `CLAUDE.md` of conventions), and `repos/codemirror/{state,view,commands,language}/` (CodeMirror 6). Read source over guessing — see `AGENTS.md`. Local skill: `.claude/skills/effect-ts`. Foldkit + CM6 UI patterns distilled with citations in `specs/01-foldkit-patterns.md`.
