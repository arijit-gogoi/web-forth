# SPEC

## §G GOAL

Authentic indirect-threaded Forth VM + split editor/console browser REPL. Real memory cells, 2 stacks, inner interpreter, CREATE/DOES> — ⊥ easyforth closures.

## §C CONSTRAINTS

- TS strict. monorepo, pnpm workspaces. node + pnpm per foldkit `engines`.
- 3 pkgs: `@web-forth/engine` (pure VM, TS only, ⊥ Effect/Foldkit), `@web-forth/client` (Foldkit + CM6 SPA + Vm svc), `@web-forth/cli` (headless node REPL). client & cli → dep engine.
- browser-only static SPA. Forth runs 100% client-side. ⊥ server, ⊥ shared pkg, ⊥ RPC.
- Effect v4 == foldkit peer dep (⊥ bump independent). `@effect/platform-browser` likewise. v4 source ∈ effect-smol repo. exact ver ∈ `package.json`.
- Foldkit. Elm Architecture: 1 immutable Model, 1 update, side effects ∈ Commands. build Vite + `@foldkit/vite-plugin`.
- editor CodeMirror 6 (`@codemirror/{state,view,commands,language}`) via foldkit `Mount.defineStream`. v1 = textarea; CM6 = v2.
- test Vitest. engine plain vitest; client `@effect/vitest` (foldkit peer ver) + happy-dom.
- threading indirect (ITC), routine-index dispatch. byte-addressed 32-bit cells over `ArrayBuffer`. fixed 256 KiB mem, 1024-cell data+return stacks. configurable, ⊥ surfaced in UI.
- errors authentic `THROW`/`CATCH` integer codes; `ABORT` + continue. Forth errors = data; Effect E-channel = VM faults only.
- client follows foldkit idioms: Schema Model, `Match`, `Array<T>`, ⊥ bracket index, ⊥ em dash. ref `repos/foldkit/CLAUDE.md` + `.claude/skills/effect-ts`.
- vendored source = read-only reference: `repos/{effect-smol,foldkit,codemirror/*}`. read source > guess. see `AGENTS.md`.
- design detail ∈ `specs/00-web-forth-overview.md`, `specs/01-foldkit-patterns.md`, `specs/02-engine-design.md`.

## §I INTERFACES

- app: `@web-forth/client` static SPA. 3 panes: editor \| console \| inspector (data stack + dictionary). Run btn + Ctrl+Enter → execute buffer.
- cli: `web-forth` node REPL. interactive prompt; pipe `.fth` file → run + print stack/output. dep engine only.
- lib: `@web-forth/engine` exports `class Forth`. `interpret(source): RunResult`, `stackSnapshot(): ReadonlyArray<number>`, `dictSnapshot(): ReadonlyArray<WordInfo>`, `reset(): void`. `RunResult = { output: string, throwCode: number|null, stack: ReadonlyArray<number> }`. ⊥ throw for Forth errors; throws `ForthFault` for VM faults only.
- svc: `Vm` Effect service (∈ client) wraps `Forth`. `interpret(src) → Effect<RunResult, ForthFault>`, `stackSnapshot`, `dictSnapshot`, `reset`. provided app-wide `Layer<Vm>` (foldkit `resources`).
- forth v1 words: arith `+ - * / mod = <> < > 0= 0< 0> and or xor invert`; stack `dup drop swap over rot >r r>`; mem `@ ! c@ c! +! , here allot cells cell+ align aligned`; io `. .s u. emit cr space type`; compile `: ; [ ] immediate ' [']`; control (immediate) `if else then begin until again do loop`; base `base decimal hex` + `$hex`; comments `( )` `\`; sys `bye abort throw`. prelude adds `?dup nip tuck 2dup 2drop abs min max negate 1+ 1- 0<> true false variable constant space spaces`.

## §R RESEARCH

id|topic|finding|src
R1|effect ver|foldkit peerDeps dictate effect + @effect/platform-browser ver. ⊥ bump independent. v4 source ∈ effect-smol. exact ver ∈ package.json|repos/foldkit/packages/foldkit/package.json:160
R2|editor bridge|imperative CM6 EditorView = `Mount.defineStream` (construction-time updateListener+keymap fire continuously). Model holds Option<hostId>; instance ∈ module registry; content pushed via Command → view.dispatch. map example = template|specs/01, repos/foldkit/CLAUDE.md, examples/map
R3|run command|`Command.define('RunSource',{source},CompletedRun,FailedRun)` reads Vm svc from resources Layer (R channel); Effect.catch folds fault|specs/01, repos/foldkit/examples/weather
R4|foldkit dsl/boot|DSL `foldkit/html` (`const h=html<Message>()`); Msg via `m()` foldkit/message; Model update `evo` foldkit/struct; boot `Runtime.makeApplication`+`Runtime.run`|specs/01, repos/foldkit/examples/counter
R5|test stack|vitest + @effect/vitest (foldkit peer ver) + happy-dom; foldkit exposes `foldkit/test/vitest`|repos/foldkit/packages/foldkit/package.json
R6|ITC in JS|routine-index dispatch (CFA = int index ∈ JS `code[]` table) replaces machine addr. single trampoline while-loop. `execute()` = [xt][HALT] scratch terminates primitive & colon xts. advisor-validated|specs/02

## §V INVARIANTS

V1: inner `NEXT` = single flat `while`. behavior routines ⊥ recurse into `run()`. ⊥ per-instruction Effect.
V2: Effect ! only @ outer-interpreter / top-level `execute` boundary. `@web-forth/engine` ⊥ import `effect` \| `foldkit`.
V3: mutable handles (`EditorView`, `Forth`/`Vm`) ∉ Foldkit Model. Model holds ! `Option<hostId>` + Schema snapshots.
V4: data-stack snapshot → Model = copied `ReadonlyArray<number>`. ⊥ live `Int32Array`.
V5: Forth errors ride success channel as `RunResult.throwCode` + output text. Effect E-channel (`ForthFault`) = genuine VM faults only. `RunSource` ∀ ordinary error → `CompletedRun`.
V6: `@ !` require cell-aligned addr (`a & 3 = 0`). debug build asserts.
V7: alloc (`,` `allot` header) reaching exec-harness region → `THROW -8`.
V8: `execute()` non-reentrant (single scratch). outer interpreter runs tokens in order. nested `EVALUATE` ⊥ till v2.
V9: over/underflow → `THROW -3/-4` (data), `-5/-6` (return); div-by-0 → `-10`; undefined word → `-13`.
V10: `ABORT` clears data stack + `state=interpret`. interpreter prints gforth-style msg + continues.
V11: colon CFA = [DOCOL]; CREATE-class CFA = [DOVAR][doesCodeAddr] (2-slot, DOES>-ready); `>BODY` = CFA+2·CELL for CREATE words.
V12: client follows foldkit idioms (Schema Model, `Match`, `Array<T>`, ⊥ bracket index, ⊥ em dash). lint-enforced.

## §T TASKS

id|status|task|cites
T1|.|scaffold pnpm workspace: engine/client/cli, pnpm-workspace.yaml, root+pkg tsconfig, deps (effect, foldkit, @codemirror/*, vitest, @effect/vitest, @foldkit/vite-plugin — vers per foldkit peer/package.json)|C
T2|.|engine: ArrayBuffer mem 256 KiB + Int32Array/Uint8Array views + registers + reserved exec-harness region|V6,V7
T3|.|engine: data+return stacks 1024 cells + push/pop + over/underflow throw|V9
T4|.|engine: dictionary header build + FIND (case-insensitive) + LATEST + smudge/immediate flags|V11
T5|.|engine: inner interpreter — code[] table, NEXT trampoline, DOCOL/EXIT/DOVAR/DOCONST/HALT, execute()|V1,V8
T6|.|engine: primitives — stack/arith/compare/logic/mem/return-stack/io|I.lib
T7|.|engine: outer interpreter — parseName/parse, number parse (BASE + $), interpret loop, QUIT|V8,V9,V10
T8|.|engine: ForthThrow unwind + top-level CATCH + ABORT + gforth-style messages|V5,V9,V10
T9|.|engine: compile mode : ; [ ] immediate + lit/branch/?branch + control-flow immediates (if/else/then, begin/until/again, do/loop)|V11
T10|.|engine: comments ( ) \\ + prelude.fth bundled raw (Vite ?raw) + boot load|C
T11|.|engine: RunResult + stackSnapshot(copy) + dictSnapshot + reset; unit tests plain vitest, easyforth golden cases|I.lib,V4
T12|.|cli: node REPL over Forth (interactive + pipe .fth)|I.cli
T13|.|client: Vm Effect service + Layer<Vm> over Forth; @effect/vitest channel tests|I.svc,V2,V5
T14|.|client: foldkit app skeleton (Model/Message/init/update/view/entry) + Runtime.makeApplication+run|R4
T15|.|client: RunSource Command (reads Vm) → CompletedRun{output,stack,throwCode} / FailedRun|R3,V5
T16|.|client: v1 textarea editor (Value+OnInput→UpdatedSource) + Ctrl+Enter (OnKeyDownPreventDefault)|I.app
T17|.|client: console pane (AsyncData Idle/Running/Ok/Err, keyed) + data-stack pane + dictionary pane|V3,V4
T18|.|client: 3-pane layout (editor \| console \| inspector) + wire RunSource + snapshot render|V3
T19|.|v2: CM6 editor via Mount.defineStream + editorHost registry + LoadExample Command|R2,V3
T20|.|v2: CREATE/DOES>/>BODY + DODOES|V11
T21|.|v2: CATCH + +LOOP ?DO i j WHILE REPEAT + char lit + strings ." s" + EVALUATE/TIB + localStorage save/load + CM6 Forth syntax mode|-

## §B BUGS

id|date|cause|fix
