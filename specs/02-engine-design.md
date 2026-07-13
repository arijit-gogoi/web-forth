# web-forth engine design (indirect-threaded) — pre-spec draft

> Draft. Feeds `/ck:spec`. Section tags in **[§?]** mark where each item lands in root `SPEC.md`. Design doc: memory map, layouts, dispatch pseudocode, primitive/prelude lists, decisions. Not implementation. No em dashes (matches `01`).

The engine is a **plain, mutable TypeScript core** (`class Forth`), with no Effect dependency. The Effect `Vm` service (`01`) is a thin wrapper over it. This keeps the inner loop tight, the core reusable in a headless CLI, and the [§V] "Effect only at the boundary" invariant structural. Packages (`00`): the pure core is **`@web-forth/engine`**; the `Vm` wrapper plus the Foldkit app are **`@web-forth/client`**; the headless REPL is **`@web-forth/cli`**. `client` and `cli` both depend on `engine`.

## Non-negotiables **[§C]**

- Indirect-threaded (ITC), adapted to JS via a **routine-index** code field (no machine addresses).
- Byte-addressed flat memory; 32-bit cells; fixed size.
- Single flat trampoline inner loop. No recursion, no per-instruction Effect.
- Authentic `THROW`/`CATCH`/`ABORT` error model. Forth errors are data, not Effect faults.
- Batch execution: one `interpret(wholeBuffer)` per Run, mapped to `RunSource(source)` (`01`).

## Memory model **[§I]**

One `ArrayBuffer`, two aliasing views (platform endianness, consistent across both, so `@` and `c@` agree):

- `cells: Int32Array` — cell access, `cell@(a) = cells[a >> 2]` (address must be 4-aligned).
- `bytes: Uint8Array` — byte access for `c@ c!` and names.

`MEM_SIZE` default `256 * 1024` (configurable, not surfaced in the UI). `CELL = 4`. Data and return stacks are **separate** `Int32Array`s (not in main memory), **1024 cells each** (configurable), with index registers. Overflow throws `-3` (data) / `-5` (return).

```
byte 0x00000  ┌────────────────────────┐
              │ dictionary + code + data│  headers, colon bodies, VARIABLEs.
              │        ↓ HERE (DP)      │  grows up.
              │        (free)          │
              ├────────────────────────┤
0x3FFF8       │ exec harness (2 cells) │  [xt][HALT_xt] for execute()
0x40000       └────────────────────────┘  MEM_SIZE

data stack : Int32Array(1024), dsp    return stack : Int32Array(1024), rsp
```

Decisions (advisor-settled):

- **Alignment.** `@ !` via `cells[a >> 2]` silently truncate an unaligned `a`. Require cell alignment; add a debug-mode alignment assert. Provide `ALIGN` (round `HERE` up to CELL) and `ALIGNED ( a -- a' )`.
- **Separate stacks** are a conscious fidelity tradeoff. `DEPTH` works; addressable `SP@ SP!` do not (v2, if ever). Noted, not silent.
- **`HERE` bounds.** Any allocation (`,`, `ALLOT`, header build) that would reach the reserved exec harness `THROW`s `-8` (dictionary overflow).

## Registers **[§I]**

| Reg | Meaning |
| --- | --- |
| `ip` | instruction pointer, byte address into code space |
| `w` | working register, byte address of the current word's code field (CFA) |
| `dsp` / `rsp` | data / return stack pointers (indices into the stack arrays) |
| `state` | `0` interpret, `1` compile |
| `base` | numeric base, default `10` |
| `here` (`dp`) | dictionary pointer (next free byte) |
| `latest` | byte address of the most recent word's link field |
| `in` | `>IN` cursor into the current source string |
| `running` | trampoline flag |

## Word (dictionary entry) layout **[§I]**

```
+0    link        : CELL   addr of previous word's link field; 0 terminates the chain
+4    lenflags    : 1 byte  bit7 IMMEDIATE, bit6 HIDDEN(smudge), bits0-5 name length (0..63)
+5    name        : len bytes (ASCII)
      ...pad to CELL alignment...
CFA   code field  : CELL   routine index into code[]        <-- xt (execution token) points HERE
PFA   param field : body (see per-class below)
```

- **xt** = address of the CFA cell. `FIND` returns `(xt, immediate)`. `'` (tick) pushes an xt. `,` / `COMPILE,` append xts.
- **Colon** word: `CFA=[DOCOL]`, body = xt list ending in `EXIT` xt. Body at `CFA + CELL`.
- **CONSTANT**: `CFA=[DOCONST]`, value at `CFA + CELL`.
- **CREATE-class** (`CREATE`, `VARIABLE`): **two-slot code field** `[CFA=DOVAR][doesCodeAddr]`, body (PFA) at `CFA + 2*CELL`. `doesCodeAddr` is unused (0) until `DOES>` sets it. `>BODY ( xt -- pfa )` returns `CFA + 2*CELL` and assumes this CREATE layout. Fixing the extra slot now means `DODOES` and `>BODY` slot in without reshuffling when DOES> lands (v2).
- **FIND is case-insensitive** (traditional). Name compare folds case.

## Inner interpreter: the ITC dispatch **[§I][§V]**

No machine addresses. A word's **code field cell holds a small integer**, an index into a JS array `code: Array<(vm) => void>` of behavior routines. `code[]` holds the inner-interpreter routines (`DOCOL`, `EXIT`, `DOVAR`, `DOCONST`, `DODOES`, `HALT`) and every primitive. A primitive word's CFA cell is that primitive's own index.

```ts
// one NEXT step (the loop body)
w = cell(ip)            // fetch next xt (address of a CFA) from the thread
ip += CELL
vm.w = w
code[cell(w)](vm)       // dispatch on the code-field routine index

// trampoline: the entire inner interpreter
run() {
  vm.running = true
  while (vm.running) {  // NEXT step, inlined
    w = cell(ip); ip += CELL; vm.w = w
    code[cell(w)](vm)
  }
}
```

Behavior routines (none recurse into `run()`; they mutate stacks and/or `ip`, then return):

```ts
DOCOL(vm)  { rpush(ip); ip = w + CELL }              // enter colon body
EXIT(vm)   { ip = rpop() }                            // return
DOVAR(vm)  { dpush(w + 2*CELL) }                      // push PFA (CREATE 2-slot layout)
DOCONST(vm){ dpush(cell(w + CELL)) }                  // push stored value
DODOES(vm) { dpush(w + 2*CELL); rpush(ip); ip = cell(w + CELL) }  // push PFA, thread into DOES> code (v2)
HALT(vm)   { vm.running = false }                     // stop trampoline, return to JS
```

**Top-level execution** from the outer interpreter uses a 2-cell harness so both primitive and colon xts terminate cleanly:

```ts
execute(xt) {
  cell_set(HALT_THREAD,        xt)       // exec harness at fixed reserved addr
  cell_set(HALT_THREAD + CELL, HALT_XT)
  ip = HALT_THREAD
  run()
}
// primitive xt: routine runs, NEXT advances to HALT_THREAD+CELL = HALT, loop stops.
// colon xt: DOCOL pushes ip(=HALT_THREAD+CELL), sets ip=body; body runs; EXIT pops back to HALT; stops.
```

**[§V] Invariants:**

- The inner interpreter is a **single flat `while` loop**. Behavior routines never call `run()`. This is the only thing that keeps deep colon nesting off the JS call stack.
- The core is **Effect-free**. Only the `Vm` wrapper is effectful.
- The exec harness is **non-re-entrant**: the outer interpreter runs tokens strictly sequentially (it does). This blocks nested `EVALUATE` until v2 (which needs a saved/restored harness or a real TIB).

## Primitives (TypeScript core) **[§I]**

Only these must be JS. Everything else is bootstrapped in the prelude.

| Group | Words |
| --- | --- |
| Inner | `DOCOL EXIT DOVAR DOCONST DODOES HALT EXECUTE` (routines; `EXECUTE` is also a word) |
| Stack | `dup drop swap over rot` (`?dup nip tuck 2dup 2drop` live in the prelude) |
| Arithmetic | `+ - * / mod /mod * negate 1+ 1-` |
| Compare / logic | `= <> < > 0= 0< 0> and or xor invert` |
| Return stack | `>r r> r@` |
| Memory | `@ ! c@ c! +! , allot here dp align aligned cells cell+ chars char+` |
| Compile support | `lit branch ?branch (do) (loop) (+loop) i j compile, [ ] literal` |
| Parsing | `( \ parse parse-name '` (tick), `[']` |
| Dictionary | `create : ; immediate find >cfa >body latest state` |
| Numeric | `base decimal hex` |
| I/O (output only, v1) | `emit cr space type . .s u. ?` |
| System | `bye abort throw catch` |

`lit` reads the next cell as an inline literal (`dpush(cell(ip)); ip += CELL`). `branch` sets `ip = cell(ip)`; `?branch` pops a flag and branches if zero. These are what immediate control-flow words compile.

## Parsing **[§I]**

v1 tokenizes the JS `source` string directly against the `in` (`>IN`) cursor. Primitives read the cursor, so parsing words work:

- `parseName() -> string | null` — skip whitespace, collect to next whitespace, advance `in`.
- `parse(delim) -> string` — collect to `delim`, advance past it.
- `(` (immediate) — `parse(')')`, discard. `\` (immediate) — skip to end of line.

Comments (`( )`, `\`) are **v1-required** even though not in the user word-set, because the prelude needs them to be readable.

TIB-in-memory (`SOURCE WORD` operating on a memory buffer) is a v2 authenticity upgrade; it also unlocks `EVALUATE`.

## Outer interpreter (text interpreter / QUIT) **[§I]**

```ts
interpret(source): RunResult {
  vm.in = 0; vm.source = source; vm.output = ''
  try {
    while (true) {
      const name = parseName()
      if (name === null) break
      const found = find(name)                 // (xt, immediate) | null
      if (found) {
        if (vm.state === COMPILE && !found.immediate) comma(found.xt)   // compile
        else execute(found.xt)                                          // run (may ForthThrow)
      } else {
        const n = parseNumber(name, vm.base)   // Option<number>
        if (n.some) {
          if (vm.state === COMPILE) { comma(LIT_XT); comma(n.value) }
          else dpush(n.value)
        } else throwCode(-13, name)            // undefined word -> "name ?"
      }
    }
    return { output: vm.output, throwCode: null, stack: snapshot() }
  } catch (e) {
    if (e instanceof ForthThrow) {             // Forth error: print, ABORT, stop this buffer
      abort()                                  // clear data stack, state=interpret
      vm.output += messageFor(e.code, e.detail)
      return { output: vm.output, throwCode: e.code, stack: snapshot() }
    }
    throw e                                    // genuine VM fault -> Effect E-channel
  }
}
```

## Error model **[§I]** (supersedes the `Effect.catch → FailedRun` sketch in `01`)

Authentic `THROW`/`CATCH`. `THROW ( code -- )` unwinds to the nearest `CATCH`; at top level the interpreter's own handler catches it. Implemented with a JS exception `class ForthThrow { code; detail }` so the throw unwinds the trampoline and any nested primitive in one step. `CATCH ( xt -- code )` (v2) installs a JS try/catch plus saved stack depths.

Standard codes:

| Code | Meaning | Trigger |
| --- | --- | --- |
| `-1` | `ABORT` | `abort` |
| `-3` | stack overflow | push past capacity |
| `-4` | stack underflow | pop empty |
| `-5` | return stack overflow | `>r` past capacity |
| `-6` | return stack underflow | `r>`/`EXIT` past base |
| `-8` | dictionary overflow | `HERE` reaches exec harness |
| `-13` | undefined word | `name ?` |
| `-10` | division by zero | `/ mod /mod` with 0 |

`ABORT` clears the data stack and sets `state=interpret`. The interpreter prints the message and stops processing the rest of the buffer (ABORT semantics), then returns. Message phrasing is informative (gforth-style): `Undefined word: foo`, `Stack underflow`, `Division by zero`.

**Channel split (the reconciliation):**

- **Ordinary Forth errors ride the success channel as data.** `RunResult { output, throwCode, stack }`. The `output` already contains the error text; `throwCode` is non-null on error.
- **The Effect E-channel (`ForthFault`) is reserved for genuine VM faults** (internal invariant violations, corrupt state). Rare.
- So `RunSource` almost always yields `CompletedRun { output, stack }` (plus `throwCode`). `FailedRun` fires only on a `ForthFault`. This is both more authentic and a better fit for Foldkit's "side effects never crash." `01` is annotated with this correction.

## Number bases **[§I]**

Parse and print honor `base`. v1: signed integer in `base`, plus a `$` prefix for hex (`$1F`). `.` and `u.` format in `base`. `DECIMAL` / `HEX` set `base`. Prefixes `#` (decimal) and `%` (binary), and char literals `'c'`, are v2.

## Prelude (bootstrapped in Forth) **[§I]**

A `prelude.fth` file, bundled as raw text (Vite `?raw`) and `interpret`ed at boot after primitives are installed. Defines higher-level words in Forth itself. Candidates:

- Stack/util: `?dup nip tuck 2dup 2drop 2swap over` (those not made primitive), `abs min max`, `0<> true false`.
- Memory helpers: `variable constant` (if not primitive), `?`.
- Printing: `space spaces`.

**Control flow decision (v1).** `IF ELSE THEN`, `BEGIN UNTIL AGAIN`, `WHILE REPEAT`, `DO LOOP +LOOP` are immediate compiling words that emit `branch`/`?branch`/`(do)`/`(loop)` and backpatch. Two ways to author them:

- **v1 (decided): implement as TypeScript immediate primitives.** Fewer moving parts, no bootstrap risk.
- **v2: reimplement in the Forth prelude** using `here`, `,`, `!`, and mark/resolve words, to demonstrate that Forth compiles its own control flow. Migrate once v1 is green.

Backpatch shapes (either way):

| Word | Compiles | Stack action (compile time) |
| --- | --- | --- |
| `IF` | `?branch`, reserve target cell | push addr of the target cell |
| `ELSE` | `branch`, reserve; resolve `IF`'s target to HERE | swap in own target addr |
| `THEN` | resolve target to HERE | pop target addr |
| `BEGIN` | nothing | push HERE |
| `UNTIL` | `?branch` with target = the `BEGIN` addr | pop |
| `AGAIN` | `branch` with target = the `BEGIN` addr | pop |
| `DO` | `(do)` | push HERE (loop top) |
| `LOOP` | `(loop)` with target = loop top | pop; uses return stack for index/limit |

## CREATE / DOES> **[§I]** (v2, layout fixed now)

`CREATE` builds a header with `CFA=[DOVAR][doesCodeAddr=0]`, body at `CFA + 2*CELL`. `DOES>` (immediate) ends the defining word and compiles `(does>)`; at the defining word's runtime, `(does>)` sets the just-created word's CFA routine to `DODOES` and its `doesCodeAddr` slot to the address right after `(does>)` (the DOES> code, a colon-style thread). `DODOES` pushes the PFA then threads into that code. `>BODY` already accounts for the 2-slot layout. Nothing about v1 needs reshuffling.

## Vm service surface **[§I]** (seam to Foldkit; ties to `01`)

Pure core, Effect-free:

```ts
type RunResult = Readonly<{ output: string; throwCode: number | null; stack: ReadonlyArray<number> }>
type WordInfo  = Readonly<{ name: string; immediate: boolean; hidden: boolean }>

class Forth {
  interpret(source: string): RunResult        // never throws for Forth errors; throws ForthFault for VM faults
  stackSnapshot(): ReadonlyArray<number>       // COPY of the data stack (never the live buffer)
  dictSnapshot(): ReadonlyArray<WordInfo>      // for the dictionary pane
  reset(): void
}
```

Effect wrapper (thin), provided app-wide as `Layer<Vm>` (`01` `resources`):

```ts
interface Vm {
  interpret(source: string): Effect<RunResult, ForthFault>
  readonly stackSnapshot: Effect<ReadonlyArray<number>>
  readonly dictSnapshot: Effect<ReadonlyArray<WordInfo>>
  readonly reset: Effect<void>
}
```

`RunSource` (`01`) becomes: run `interpret`, always map to `CompletedRun { output, stack }` (carry `throwCode`); only a `ForthFault` maps to `FailedRun`.

> **Verify at scaffold:** the exact Effect v4 `Effect.Service` / `Layer` construction and `@effect/vitest` API shifted in v4. Pull the concrete shapes from `repos/effect-smol/packages/effect` and `.claude/skills/effect-ts` when writing this. The method signatures above are framework-agnostic and stable; the wiring is what to confirm.

## Testing **[§T]**

- **Pure `Forth`, plain `vitest`.** Drive `interpret`, assert `output` + `stackSnapshot`. Examples: `4 5 + .` -> output `"9 "`, empty stack; `: sq dup * ; 3 sq .` -> `"9 "`; `.` on empty -> `throwCode -4`, output contains `stack underflow`; `foo` -> `throwCode -13`, output `foo ?`. Golden cases lifted from easyforth.
- **`Vm` wrapper, `@effect/vitest`.** Confirm channel mapping (Forth error stays success; injected fault hits E-channel).

## Scope **[§T]**

- **v1**: memory + stacks + inner/outer interpreter + `: ;` + primitives + control flow (TS immediates) + `>r r>` + memory words + `THROW`/`ABORT` + `BASE`(+`$`) + comments + a small Forth prelude + `.s .` output. Editor = textarea (`01` §D). No CM6 yet.
- **v2**: CM6 editor (`01` §C), `CREATE`/`DOES>`/`>BODY`, `CATCH`, `+LOOP ?DO WHILE REPEAT i j`, char literals + string words (`." s"`), `EVALUATE` + TIB-in-memory, control flow reimplemented in the prelude, `KEY`/`ACCEPT`, save/load (localStorage), Forth syntax mode (`@codemirror/language`).

## Resolved defaults (grill, 2026-07-13) **[§C]**

1. `?dup nip tuck 2dup 2drop` and other non-core stack words live in the **prelude**, not as primitives (minimal core).
2. Data stack / return stack: **1024 cells each** (configurable). Overflow `-3` (data) / `-5` (return).
3. `MEM_SIZE`: **256 KiB** (configurable), **not surfaced in the UI**.
4. `.` is **signed**, `u.` is **unsigned** (cell is `Int32`). Standard.
5. Prelude is a **`prelude.fth` file bundled raw** (Vite `?raw`), not a TS template string.
6. Error messages are **informative, gforth-style** (`Undefined word: foo`, `Stack underflow`).
7. v1 control flow (`IF/ELSE/THEN`, `BEGIN/UNTIL`, `DO/LOOP`) = **TypeScript immediate words**; reimplement in the prelude in v2.

No engine sub-questions remain open. Items genuinely deferred to v2 are under Scope.
