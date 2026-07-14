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
| Language | **TypeScript** (strict) | Match Foldkit. Version pinned in `package.json`. |
| Effect system | **Effect v4** | Version **dictated by Foldkit's `peerDependencies`** (both `effect` and `@effect/platform-browser`). Do **not** bump independently of Foldkit; read the exact version from `package.json`. Source lives in the `effect-smol` repo. |
| UI framework | **Foldkit** | Elm Architecture: Model / Message / Command / Subscription / Mount. Apps use `@foldkit/vite-plugin`; `create-foldkit-app` scaffolds. Version pinned in `package.json`. |
| Editor | **CodeMirror 6** via Foldkit **`Mount.defineStream`** (Extended) | Packages `@codemirror/{state,view,commands,language}`, vendored to `repos/codemirror/`. CM6 is TEA-shaped (immutable `EditorState`, transactions, `EditorView` projection). The imperative `EditorView` lives in a module registry (out of the Model); edits and a Mod-Enter keymap emit Messages. Core ships a textarea; CM6 is Extended (§T.19). Full patterns: `specs/01-foldkit-patterns.md`. |
| Repo shape | **Monorepo of packages** | pnpm workspaces (`packages/*`). |
| Runtime / PM | **Node + pnpm** | Mirror Foldkit's `engines`; versions pinned in `package.json`. |
| Test runner | **Vitest** via **`@effect/vitest`** | Effect-aware. DOM tests via **`happy-dom`**. Foldkit exposes a `foldkit/test/vitest` entry. Versions pinned in `package.json`. |
| Build | **Vite** + `@foldkit/vite-plugin` | Match Foldkit toolchain. |

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
- **`CREATE`/`DOES>`:** crown jewel — `CREATE` builds a header whose default behavior pushes PFA; `DOES>` rewrites the last word's code field to run the `DOES>` thread after pushing PFA. ITC makes this clean. **Extended** (structure now, implement after Core).

### Errors **[§I]**

Authentic `THROW`/`CATCH` with integer codes (`-1` ABORT, `-3`/`-4` stack over/underflow, `-8` dict overflow, `-10` div-by-zero, `-13` undefined word). The outer interpreter (`QUIT`) catches, prints, `ABORT`s (clears the data stack), and continues. **Ordinary Forth errors ride the success channel as data** (`RunResult { output, throwCode }`); the Effect **E-channel (`ForthFault`) is reserved for genuine VM faults**. Full model + codes: `specs/02-engine-design.md`.

## Package layout **[§I]**

```
packages/
  engine/     # pure Forth VM: memory, stacks, inner (NEXT/DOCOL/EXIT), dict, outer, errors, prelude. TS only, no Effect/Foldkit.  @web-forth/engine
  client/     # Foldkit + CM6 SPA: Model/Message/update/view, Vm service, editor + console + stack/dict panes; @foldkit/vite-plugin.  @web-forth/client
  cli/        # headless node REPL over engine: interactive prompt + pipe .fth files.  @web-forth/cli
```

`client` and `cli` both depend on `engine`. The `Vm` Effect service lives in **`client`** (keeps `engine` Effect-free); `cli` drives the pure `Forth` core directly. No `shared` / `server`: web-forth is a browser-only static SPA, Forth runs entirely client-side. A `server` + `shared` (Effect RPC, now in core `effect`) would appear only for future share-links / collaboration / server-side persistence.

## Core word-set **[§T]**

This draft under-counted; the authoritative Core list is `SPEC.md` §I "forth Core words" (machine-checked by `golden.test.ts`). Recap of what actually ships:

- Arithmetic: `+ - * / mod` (plus `/mod negate 1+ 1-`)
- Compare / logic: `= <> < > 0= 0< 0> and or xor invert` (Forth uses `invert`, not `not`)
- Stack: `dup drop swap over rot`
- Return stack: `>r r> r@`
- I/O: `. .s u. emit cr space type`
- Compile / defining: `: ; [ ] immediate literal ' [']` and `variable constant`
- Control flow (immediate): `if else then`, `begin until again`, `do loop`
- Memory (authentic): `@ ! c@ c! +! , here allot cells cell+ align aligned`
- Base: `base decimal hex` (plus a `$` hex prefix)
- Comments: `( )`, `\`
- System: `bye abort throw`
- Prelude (Forth-defined): `?dup nip tuck 2dup 2drop abs min max 0<> true false spaces`

**Extended:** `CREATE`/`DOES>`/`>BODY`, `CATCH`, `+LOOP ?DO i j WHILE REPEAT`, char literals, string words (`." s"`), `EVALUATE`/TIB, `[COMPILE]`/`POSTPONE`, `KEY`/`ACCEPT`, localStorage save/load, CM6 syntax mode.

## Foldkit conventions **[§C]**

The `ui` package follows Foldkit idioms (enforced by Foldkit's lint + review): Schema-typed Model, verb-past-tense Messages (`PressedKey`, `CompletedRun`), Commands verb-first (`RunSource`), `Match`/`M.tagsExhaustive` over `switch`, `Array<T>` (never `T[]`), no bracket indexing (`Array.get`/`Array.head`), `Option` for absence, no em dashes in prose. Full rules: `repos/foldkit/CLAUDE.md` + the local `.claude/skills/effect-ts` skill. Read those before writing `ui` code.

## Open questions **[§?]**

All engine sub-questions are resolved (grilled 2026-07-13; see `specs/02-engine-design.md` "Resolved defaults"). Recap:

1. ~~Cell addressing~~ → **byte-addressed**, 32-bit cells over an `ArrayBuffer` (`02`).
2. ~~Foldkit effect-dispatch~~ → **Commands** (`update` returns `[Model, Command]`).
3. ~~Memory size / growth~~ → **fixed 256 KiB** (`02`).
4. ~~Number bases~~ → **`BASE`, default decimal, `$` hex** (`02`).
5. ~~Editor bridge~~ → **CodeMirror 6 via `Mount.defineStream`** (`01`). Forth syntax mode deferred to Extended.
6. ~~Prelude / control flow~~ → **minimal TS primitives + `prelude.fth`; Core control flow as TS immediates** (`02`).
7. **Persistence** (save/load definitions) → **Extended**.

Nothing blocks `/ck:spec`.

## Vendored reference

`repos/effect-smol/` (Effect v4 source; see `ai-docs/`, `LLMS.md`, `packages/effect`, `packages/atom`, `packages/platform-browser`, `packages/vitest`), `repos/foldkit/` (`examples/`, `packages/foldkit`, `packages/create-foldkit-app`, `packages/vite-plugin-foldkit`, and its own `CLAUDE.md` of conventions), and `repos/codemirror/{state,view,commands,language}/` (CodeMirror 6). Read source over guessing — see `AGENTS.md`. Local skill: `.claude/skills/effect-ts`. Foldkit + CM6 UI patterns distilled with citations in `specs/01-foldkit-patterns.md`.
