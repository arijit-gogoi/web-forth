# CLAUDE.md — web-forth

Authentic **indirect-threaded (ITC) Forth VM** with a browser REPL. Inspired by easyforth, but a real threaded-code virtual machine (memory cells, two stacks, inner interpreter, `CREATE`/`DOES>`), not JS closures.

## Source of truth

- **`SPEC.md`** (root) is authoritative: §G goal, §C constraints, §I interfaces, §R research, §V invariants, §T tasks, §B bugs. Read it before working.
- **`specs/`** holds the design docs behind the spec (`00` overview, `01` Foldkit/CM6 patterns, `02` engine design).
- **`AGENTS.md`** covers the vendored-source rules and stack.

## Spec-driven workflow (cavekit `/ck:*`)

Work routes through the skills, not ad-hoc edits:

- `/ck:grill` sharpens an idea into §G/§C. `/ck:spec` is the **sole mutator** of `SPEC.md`. `/ck:review` red-teams §V before code. `/ck:build` implements one §T task.
- **Build loop**: pick a §T task, plan and name the test that proves each cited §V, implement, run the verification oracle, flip §T status `.` to `~` to `x`, commit `T<n>: <goal>`. One task per commit.
- Build only flips §T status. Every other `SPEC.md` edit goes through `/ck:spec`.

## Architecture (load-bearing rules)

Monorepo, pnpm workspaces. `client` and `cli` depend on `engine`.

- **`packages/engine`** (`@web-forth/engine`) is the pure Forth VM: `class Forth`, memory, stacks, inner and outer interpreter, dictionary, prelude. **Plain mutable TypeScript, no Effect, no Foldkit** (§V.2). Plain vitest.
- **`packages/client`** (`@web-forth/client`) is the Foldkit + CodeMirror 6 SPA. It wraps the engine in the `Vm` Effect service. Tested with `@effect/vitest` + happy-dom.
- **`packages/cli`** (`@web-forth/cli`) is a headless node REPL driving the pure core directly.

Browser-only static SPA: Forth runs entirely client-side. No server, no `shared` package, no RPC. The `cli` is a node dev tool, not the shipped app.

Invariants that shape the code (authoritative list in §V):

- The inner `NEXT` loop is a **single flat `while`** with routine-index dispatch. No recursion into it, no per-instruction Effect. Effect is used only at the outer-interpreter / top-level `execute` boundary.
- **Mutable handles never enter the Foldkit Model.** The `EditorView` lives in a module registry, the `Forth`/`Vm` as an Effect service; the Model holds only an `Option<hostId>` plus **copied** Schema snapshots (the stack snapshot is a `ReadonlyArray<number>` copy, never the live `Int32Array`).
- **Forth errors are data, not exceptions.** Authentic `THROW`/`CATCH` integer codes; the outer interpreter prints, `ABORT`s, and continues. Ordinary errors ride the success channel (`RunResult`); the Effect E-channel (`ForthFault`) is only for genuine VM faults.

## Do not hardcode versions

Dependency versions live **only** in `package.json`. Do not write version numbers into docs, comments, or the spec. The Effect version is dictated by Foldkit's peer dependency: never bump Effect independently of Foldkit, and read the exact version from `packages/*/package.json` when you need it.

## Vendored source: read it, do not guess

`repos/` holds read-only vendored source (Effect, Foldkit, CodeMirror 6) embedded via `git subtree`. When unsure of an API, read the actual source under `repos/` rather than trusting stale memory. Foldkit's own conventions live in `repos/foldkit/CLAUDE.md`; the local `.claude/skills/effect-ts` skill covers Effect patterns.

## Client (Foldkit) idioms

In `packages/client`, follow Foldkit style (lint-enforced): Schema-typed Model, `Match` over `switch`, `Array<T>` not `T[]`, no bracket indexing (`Array.get` / `Array.head`), `Option` for absence, no em dashes in prose. See `repos/foldkit/CLAUDE.md`.

## Commands

- `pnpm -r typecheck` — typecheck every package.
- `pnpm -r test` — run every package's tests.
- `pnpm --filter @web-forth/engine test` — engine tests only.
- `pnpm --filter @web-forth/client dev` — run the app (once the client app exists).
