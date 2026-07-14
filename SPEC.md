# SPEC

## §G GOAL

Authentic indirect-threaded Forth VM + split editor/console browser REPL. Real memory cells, 2 stacks, inner interpreter, CREATE/DOES> — ⊥ easyforth closures.

## §C CONSTRAINTS

- TS strict. monorepo, pnpm workspaces. node + pnpm per foldkit `engines`.
- 3 pkgs: `@web-forth/engine` (pure VM, TS only, ⊥ Effect/Foldkit), `@web-forth/client` (Foldkit + CM6 SPA + Vm svc), `@web-forth/cli` (headless node REPL). client & cli → dep engine.
- app = browser-only static SPA. Forth runs 100% client-side. ⊥ server, ⊥ shared pkg, ⊥ RPC. cli = node dev/aux tool over engine, ≠ shipped app.
- Effect v4 == foldkit peer dep (⊥ bump independent). `@effect/platform-browser` likewise. v4 source ∈ effect-smol repo. exact ver ∈ `package.json`.
- Foldkit. Elm Architecture: 1 immutable Model, 1 update, side effects ∈ Commands. build Vite + `@foldkit/vite-plugin`.
- editor CodeMirror 6 (`@codemirror/{state,view,commands,language}`) via foldkit `Mount.defineStream`. Core = textarea; CM6 = Extended.
- test Vitest. engine plain vitest; client `@effect/vitest` (foldkit peer ver) + happy-dom.
- threading indirect (ITC), routine-index dispatch. byte-addressed 32-bit cells over `ArrayBuffer`. fixed 256 KiB mem, 1024-cell data+return stacks. configurable, ⊥ surfaced in UI.
- errors authentic `THROW`/`CATCH` integer codes; `ABORT` + continue. Forth errors = data; Effect E-channel = VM faults only.
- prelude = `prelude.fth` (source of truth) → codegen `prelude.generated.ts` (`export const PRELUDE`) at build. engine loads identically in node (cli/vitest) & browser. ⊥ Vite-only `?raw` (engine runs in node cli).
- client follows foldkit idioms: Schema Model, `Match`, `Array<T>`, ⊥ bracket index, ⊥ em dash. ref `repos/foldkit/CLAUDE.md` + `.claude/skills/effect-ts`.
- vendored source = read-only reference: `repos/{effect-smol,foldkit,codemirror/*}`. read source > guess. see `AGENTS.md`.
- design detail ∈ `specs/00-web-forth-overview.md`, `specs/01-foldkit-patterns.md`, `specs/02-engine-design.md`.

## §I INTERFACES

- app: `@web-forth/client` static SPA. 3 panes: editor \| console \| inspector (data stack + dictionary). Run btn + Ctrl+Enter → execute buffer.
- cli: `web-forth` node REPL. interactive prompt; pipe `.fth` file → run + print stack/output. dep engine only.
- lib: `@web-forth/engine` exports `class Forth`. `interpret(source): RunResult`, `stackSnapshot(): ReadonlyArray<number>`, `dictSnapshot(): ReadonlyArray<WordInfo>`, `reset(): void`. `RunResult = { output: string, throwCode: number|null, stack: ReadonlyArray<number> }`. ⊥ throw for Forth errors; throws `ForthFault` for VM faults only.
- svc: `Vm` Effect service (∈ client) wraps `Forth`. `interpret(src) → Effect<RunResult, ForthFault>`, `stackSnapshot`, `dictSnapshot`, `reset`. provided app-wide `Layer<Vm>` (foldkit `resources`).
- forth Core words: arith `+ - * / mod = <> < > 0= 0< 0> and or xor invert`; stack `dup drop swap over rot >r r>`; mem `@ ! c@ c! +! , here allot cells cell+ align aligned`; io `. .s u. emit cr space type`; compile `: ; [ ] immediate literal ' [']`; control (immediate) `if else then begin until again do loop`; base `base decimal hex` + `$hex`; comments `( )` `\`; sys `bye abort throw`. prelude adds `?dup nip tuck 2dup 2drop abs min max negate 1+ 1- 0<> true false variable constant space spaces`.
- forth Extended words: `catch` (`( xt -- code )`, nested→nearest); control `+loop ?do i j while repeat`; strings `s" ." char [char]`; `evaluate ( c-addr u -- )`. (Core `throw` gains authentic `catch` semantics.)
- Extended editor: CM6 `EditorView` via `Mount.defineStream` replaces the textarea; feeds same `UpdatedSource`/`PressedRun` facts + `LoadExample` Command. Optional Forth syntax mode (`@codemirror/language`).
- Extended persistence: editor buffer text autosaved (debounced) → `localStorage` key `web-forth.source`, restored @ boot ∈ `init`. ⊥ dictionary state (re-run reconstructs words).

## §R RESEARCH

id|topic|finding|src
R1|effect ver|foldkit peerDeps dictate effect + @effect/platform-browser ver. ⊥ bump independent. v4 source ∈ effect-smol. exact ver ∈ package.json|repos/foldkit/packages/foldkit/package.json:160
R2|editor bridge|imperative CM6 EditorView = `Mount.defineStream` (construction-time updateListener+keymap fire continuously). Model holds Option<hostId>; instance ∈ module registry; content pushed via Command → view.dispatch. map example = template|specs/01, repos/foldkit/CLAUDE.md, examples/map
R3|run command|`Command.define('RunSource',{source},CompletedRun,FailedRun)` reads Vm svc from resources Layer (R channel); Effect.catch folds fault|specs/01, repos/foldkit/examples/weather
R4|foldkit dsl/boot|DSL `foldkit/html` (`const h=html<Message>()`); Msg via `m()` foldkit/message; Model update `evo` foldkit/struct; boot `Runtime.makeApplication`+`Runtime.run`|specs/01, repos/foldkit/examples/counter
R5|test stack|vitest + @effect/vitest (foldkit peer ver) + happy-dom; foldkit exposes `foldkit/test/vitest`|repos/foldkit/packages/foldkit/package.json
R6|ITC in JS|routine-index dispatch (CFA = int index ∈ JS `code[]` table) replaces machine addr. single trampoline while-loop. `execute()` = [xt][HALT] scratch terminates primitive & colon xts. advisor-validated|specs/02

## §V INVARIANTS

V1: inner `NEXT` = single flat `while`. behavior routines ⊥ recurse into `run()` — EXCEPT sanctioned nested-run sites `catch`/`evaluate` (§V17/§V18), which ! save+restore full ctx so the enclosing trampoline survives. ⊥ per-instruction Effect.
V2: Effect ! only @ outer-interpreter / top-level `execute` boundary. `@web-forth/engine` ⊥ import `effect` \| `foldkit`.
V3: mutable handles (`EditorView`, `Forth`/`Vm`) ∉ Foldkit Model. Model holds ! `Option<hostId>` + Schema snapshots.
V4: data-stack snapshot → Model = copied `ReadonlyArray<number>`. ⊥ live `Int32Array`.
V5: Forth errors ride success channel as `RunResult.throwCode` + output text. Effect E-channel (`ForthFault`) = genuine VM faults only. `RunSource` ∀ ordinary error → `CompletedRun`.
V6: `@ !` require cell-aligned addr (`a & 3 = 0`). debug build asserts.
V7: alloc (`,` `allot` header) reaching exec-harness region → `THROW -8`.
V8: `execute()` non-reentrant (single scratch). outer interpreter runs tokens in order. nested `EVALUATE` ⊥ till Extended.
V9: over/underflow → `THROW -3/-4` (data), `-5/-6` (return); div-by-0 → `-10`; undefined word → `-13`; compile-only word in interpret → `-14`; step-budget exceeded → `-28`.
V10: `ABORT` clears data + return stacks (dsp=rsp=0) + `state=interpret` + `running=false`. interpreter prints gforth-style msg + continues.
V11: colon CFA = [DOCOL]; CREATE-class CFA = [DOVAR][doesCodeAddr] (2-slot, DOES>-ready); `>BODY` = CFA+2·CELL for CREATE words.
V12: client follows foldkit idioms (Schema Model, `Match`, `Array<T>`, ⊥ bracket index, ⊥ em dash). lint-enforced.
V13: ⊥ concurrent `Vm.interpret` (shared mutable core). `update` ignores `ClickedRun`/`PressedRun` while console `AsyncData==Loading`; Vm serializes interpret.
V14: inner loop enforces step budget. exceed → `THROW -28` (keeps main thread responsive). Extended → Web Worker for true interrupt.
V15: compile-only words (control-flow immediates: `;` if/then/…) self-check `state`; run @ `state==interpret` → `THROW -14`. no header flag (lenflags byte full: 0x80|0x40|0x3F); guard ∈ each word.
V16: `prelude.fth` `interpret`s @ boot with `throwCode==null`; else fatal `ForthFault` (⊥ silent half-init).
V17: (Extended) `catch ( xt -- code )` runs xt via a nested `execute`→`run()` (a §V1 carve-out). ∴ ! save `{dsp,rsp,ip,w,harness,running}` before, restore ALL on BOTH paths: clean exit (nested HALT clears `running`+clobbers `ip`/`w`/harness → enclosing loop dies if unrestored) AND `ForthThrow` (unwinds past nested run). clean → push 0; throw → restore dsp+rsp to saved depths + push code. `throw 0` = no-op (⊥ unwind, ANS). nested `catch` → nearest.
V18: (Extended) `evaluate ( c-addr u -- )` runs a nested text-interpret (a §V1 carve-out, harness non-reentrant §V.8). ⊥ call public `interpret()` (it wipes `output`, forth.ts:229). ! save+restore `{ip,w,harness,running,source,toIn}` + preserve accumulated `output` around the nested loop. ⊥ leak nested parse state to caller.
V19: (Extended) CM6 `EditorView` (mutable handle) ∉ Model (extends §V.3). lives ∈ module registry keyed `hostId`; Model holds ! `Option<hostId>`. external writes → Command dispatches CM6 transaction (⊥ re-mount; mount args captured @ mount ∴ seed arg named `initialDoc`). unmount → `view.destroy()` + registry delete.
V20: (Extended) compiled `s"`/`."` store bytes inline ∈ definition thread; `(s")` runtime reads inline count + bytes, pushes `( c-addr u )`, advances `ip` past the cell-aligned byte payload (precedent: `lit`). ⊥ transient side-buffer, ⊥ `'c'` shortcut (`char`/`[char]` for char codes).
V21: (Extended) persistence fail-silent — `localStorage` quota/disabled → no-op Message, ⊥ crash the run loop. autosave debounced on edit; buffer text only.
V22: (Extended) `+loop ( n -- )` terminates on boundary crossing (sign of `index-limit` flips), ⊥ `index<limit` (existing `(loop)` forth.ts:611 upward-only). supports negative step. `?do` skips body when `limit==index` @ entry. `i` = innermost loop index (rstack top pair), `j` = next-outer.
V23: (Extended) interpreted `s"`/`."` (interpret state, no thread to inline into) → compile-only: `THROW -14` outside a definition. (compiled path = bytes inline ∈ thread, §V20.) ⊥ transient side-buffer either mode.
V24: (Extended) `>BODY` defined only for CREATE-class words (CFA routine == `DOVAR`/`DODOES`, 2-slot §V11). other xt (`constant`=`[DOCONST][value]` 1-slot forth.ts:803, colon) → ⊥ valid body; guard or `THROW`.

## §T TASKS

Phases (one continuous build, not shipped releases): **Core** = the working base (engine + REPL + textarea UI, T1-T18, done). **Extended** = deeper authenticity + polish (DOES>, CATCH, CM6, strings, save/load; T19+).

id|status|task|cites
T1|x|scaffold pnpm workspace: engine/client/cli, pnpm-workspace.yaml, root+pkg tsconfig, deps (effect, foldkit, @codemirror/*, vitest, @effect/vitest, @foldkit/vite-plugin — vers per foldkit peer/package.json)|C
T2|x|engine: ArrayBuffer mem 256 KiB + Int32Array/Uint8Array views + registers + reserved exec-harness region|V6,V7
T3|x|engine: data+return stacks 1024 cells + push/pop + over/underflow throw|V9
T4|x|engine: dictionary header build + FIND (case-insensitive) + LATEST + smudge/immediate flags|V11
T5|x|engine: inner interpreter — code[] table, NEXT trampoline + step-budget watchdog, DOCOL/EXIT/DOVAR/DOCONST/HALT, execute()|V1,V8,V14
T6|x|engine: primitives — stack/arith/compare/logic/mem/return-stack/io|I.lib
T7|x|engine: outer interpreter — parseName/parse, number parse (BASE + $), interpret loop, QUIT|V8,V9,V10
T8|x|engine: ForthThrow unwind + top-level catch handler (interpreter) + ABORT + gforth-style messages|V5,V9,V10
T9|x|engine: compile mode : ; [ ] immediate + lit/branch/?branch + control-flow immediates (if/else/then, begin/until/again, do/loop) + compile-only guard|V11,V15
T10|x|engine: comments ( ) \\ + prelude.fth + codegen prelude.generated.ts (const PRELUDE) at build (node+browser+vitest) + boot load (fail → ForthFault)|C,V16
T11|x|engine: RunResult + stackSnapshot(copy) + dictSnapshot + reset; unit tests plain vitest, easyforth golden cases|I.lib,V4
T12|x|cli: node REPL over Forth (interactive + pipe .fth)|I.cli
T13|x|client: Vm Effect service (serialize interpret) + Layer<Vm> over Forth; verify effect v4 Effect.Service/Layer + @effect/vitest API vs repos/effect-smol; channel tests|I.svc,V2,V5,V13
T14|x|client: foldkit app skeleton (Model/Message/init/update/view/entry) + Runtime.makeApplication+run|R4
T15|x|client: RunSource Command (reads Vm, ignored while Loading) → CompletedRun{output,stack,throwCode} / FailedRun|R3,V5,V13
T16|x|client: Core textarea editor (Value+OnInput→UpdatedSource) + Ctrl+Enter (OnKeyDownPreventDefault)|I.app
T17|x|client: console pane (AsyncData Idle/Running/Ok/Err, keyed) + data-stack pane + dictionary pane|V3,V4
T18|x|client: 3-pane layout (editor \| console \| inspector) + wire RunSource + snapshot render|V3
T19|.|Extended: CM6 editor plain — add `@codemirror/{state,view,commands,language}` deps (⊥ declared/installed yet; T1 gap) + Mount.defineStream + editorHost registry + LoadExample Command, feeds same `UpdatedSource` (⊥ syntax mode yet)|R2,V3,V19
T20|x|Extended: CREATE/DOES>/>BODY + DODOES|V11,V24
T21|.|Extended: CATCH/THROW authentic — `catch ( xt -- code )`, nested→nearest, `throw 0` no-op|V17
T22|.|Extended: control-flow completion — `+loop ?do i j while repeat`|V15,V22
T23|.|Extended: strings/char proper Forth — `s" ." char [char]`, bytes inline ∈ thread via `(s")`, ⊥ transient buf, ⊥ `'c'`|V20,V23
T24|.|Extended: EVALUATE + TIB-in-memory — nested text interpret|V18
T25|.|Extended: save/load — editor buffer ∈ localStorage, debounced autosave, restore @ init|V21,V3
T26|.|Extended: CM6 Forth syntax mode (`@codemirror/language`)|R2

## §B BUGS

id|date|cause|fix
B1|2026-07-14|`ForthThrow` unwinds JS stack ⊥ run pending `EXIT`s ∴ `rsp` dirty mid-colon → next `interpret()` misbehaves. §V.10 now ! abort reset dsp+rsp+running.
