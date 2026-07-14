# web-forth

An authentic **indirect-threaded (ITC) Forth virtual machine** with a browser REPL.

Not a Forth interpreter built from JavaScript closures (the easyforth approach), but a
real threaded-code VM: byte-addressed memory cells over an `ArrayBuffer`, a data stack
and a return stack, an inner interpreter (`NEXT`) driven by routine-index dispatch, a
dictionary of compiled words, and `CREATE`/`DOES>`. The whole VM runs client-side in the
browser, with no server.

**Live: https://arijit-gogoi.github.io/web-forth/**

```forth
: square dup * ;
5 square .    \ => 25
```

## What makes it authentic

- **Indirect threading.** Each word's code field holds a routine index into a JS routine
  table (standing in for a machine address). Colon words are threads of execution tokens;
  the inner interpreter is a single flat trampoline (`while` loop), never recursion.
- **Real two-stack machine.** Separate data and return stacks over fixed memory (256 KiB,
  1024-cell stacks by default). `>r` / `r>` / `r@`, and `DO` loop indices (`i` / `j`) live
  on the return stack, as in a real Forth.
- **`CREATE` / `DOES>` / `>BODY`.** Defining words build child words with a parameter
  field and custom runtime behavior, via an authentic `DODOES` inner routine.
- **`THROW` / `CATCH` / `ABORT`.** Errors are authentic integer throw codes, not
  exceptions. `CATCH` runs an xt and returns 0 or the throw code; the outer interpreter
  prints a gforth-style message, `ABORT`s, and continues.
- **A prelude written in Forth.** Higher-level words (`?dup`, `2dup`, `abs`, `min`, `max`,
  ...) are defined in `prelude.fth` and compiled by the VM at boot, exactly as a real
  system bootstraps itself.

## The word set

**Core** (primitives + prelude):

- arithmetic: `+ - * / mod = <> < > 0= 0< 0> and or xor invert 1+ 1- negate abs min max`
- stack: `dup drop swap over rot ?dup nip tuck 2dup 2drop >r r> r@`
- memory: `@ ! c@ c! +! , here allot cells cell+ align aligned`
- I/O: `. .s u. emit cr space spaces type`
- compiling: `: ; [ ] immediate literal ' [']`
- control flow: `if else then begin until again do loop`
- numeric base: `base decimal hex` (plus `$`-prefixed hex literals)
- defining: `variable constant create`
- comments: `( ... )` and `\ ...`
- system: `bye abort throw`

**Extended:**

- `catch ( xt -- code )` with authentic nested-to-nearest semantics
- more control flow: `+loop ?do i j while repeat`
- strings and char literals: `s" ." char [char]`
- `evaluate ( c-addr u -- )`

## Architecture

A pnpm monorepo of three packages. `client` and `cli` depend on `engine`.

| Package | What it is |
| --- | --- |
| **`@web-forth/engine`** | The pure Forth VM. Plain mutable TypeScript, no Effect, no framework. `class Forth` with `interpret()`, `stackSnapshot()`, `dictSnapshot()`, `reset()`. The single source of Forth behavior. |
| **`@web-forth/client`** | The browser SPA. Foldkit (Elm Architecture, on Effect) + [CodeMirror 6](https://codemirror.net/). Three panes: editor, console, inspector (data stack + dictionary). Wraps the engine in a `Vm` Effect service. |
| **`@web-forth/cli`** | A headless Node REPL over the engine (interactive prompt, or pipe a `.fth` file). A development tool, not the shipped app. |

The engine is deliberately framework-free so it loads identically under Node (CLI, tests)
and in the browser. The client is the only thing that ships; it is a static SPA (Forth
runs entirely in the page), built with Vite and deployed to GitHub Pages.

### How the VM runs (indirect threading)

The code field of every word holds an **index** into an array of routines rather than a
machine address. The inner interpreter is one flat loop:

1. fetch the execution token at the instruction pointer,
2. read its routine index from the code field,
3. dispatch to that routine,
4. repeat until a `HALT` marker.

Colon definitions push a return address and jump into their thread (`DOCOL`); `EXIT` pops
back. `CREATE`-class words run `DOVAR` / `DOCONST` / `DODOES`. `execute()` drives a single
xt to completion by writing `[xt][HALT]` into a scratch region and running the loop. There
is no per-instruction framework overhead: the loop is a plain `while` with a routine-index
switch.

## Development

Requires Node and pnpm (versions per the workspace `engines` / `packageManager` fields).

```bash
pnpm install

pnpm --filter @web-forth/client dev     # run the app locally (Vite dev server)
pnpm --filter @web-forth/client build   # production build -> packages/client/dist

pnpm -r typecheck                        # typecheck every package
pnpm -r test                             # run every package's tests
pnpm --filter @web-forth/engine test     # engine tests only

pnpm --filter @web-forth/cli dev         # the Node REPL
```

The client is built and published to GitHub Pages automatically on every push to `main`
(`.github/workflows/deploy-pages.yml`).

## Repository layout

```
packages/
  engine/    the pure ITC Forth VM (memory, stacks, inner + outer interpreter, dictionary)
    src/
      forth.ts             class Forth: composition + outer interpreter
      inner.ts             the NEXT trampoline + DOCOL/DOVAR/DODOES routines
      primitives/          the primitive word set, grouped by kind
      prelude.fth          the Forth-source prelude (compiled at boot)
  client/    the Foldkit + CodeMirror 6 SPA
  cli/       the headless Node REPL

SPEC.md      the authoritative specification (goal, constraints, interfaces, invariants)
specs/       the design documents behind the spec
repos/       vendored read-only source (Effect, Foldkit, CodeMirror) via git subtree
```

`SPEC.md` is the source of truth. It carries the goal (§G), constraints (§C), interfaces
(§I), research (§R), invariants (§V), and the task list (§T).
