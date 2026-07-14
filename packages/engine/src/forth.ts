// @web-forth/engine — class Forth: composes the VM and installs primitives (SPEC
// §T.6, §I.lib). The outer interpreter (§T.7) and THROW/CATCH/ABORT (§T.8) build on
// this; the public interpret()/snapshots (§I.lib) arrive in §T.7/§T.11.
//
// Composition + address-0 ownership (the T5 note, now resolved): the Dictionary is
// the SOLE owner of the reserved boot cell at address 0. Its constructor allots that
// cell; Inner writes HALT's routine index into it but never allots. Constructing
// Inner BEFORE the Dictionary would let Inner's HALT-write land before the reserve,
// but here Dictionary reserves first, then Inner writes HALT there. Do not add an
// allot to Inner or the boot cell is double-reserved (phantom cell at 4).

import {
  Dictionary,
  FLAG_HIDDEN,
  FLAG_IMMEDIATE,
  LENFLAGS_OFFSET,
  NAME_LEN_MASK,
  NAME_OFFSET,
} from './dictionary'
import {
  ForthFault,
  ForthThrow,
  THROW_COMPILE_ONLY,
  THROW_UNDEFINED_WORD,
} from './errors'
import { PRELUDE } from './prelude.generated'
import { DOCOL, DOCONST, DODOES, DOVAR, EXIT, Inner, type Routine } from './inner'
import { CELL, Memory } from './memory'
import { messageFor } from './messages'
import {
  makeRegisters,
  STATE_COMPILE,
  STATE_INTERPRET,
  type Registers,
} from './registers'
import { makeDataStack, makeReturnStack, type Stack } from './stack'
import { installCore } from './primitives/core'
import {
  installControlFlow,
  installDefiningState,
  installRuntimes,
} from './primitives/compiler'
import { installDataDefining } from './primitives/defining'
import { installExit, installExtended } from './primitives/extended'

export interface ForthConfig {
  readonly memSize?: number
  readonly stackCells?: number
  readonly stepBudget?: number
}

// §I.lib: interpret() result. Forth errors ride this success channel as data
// (throwCode non-null + output text); genuine VM faults throw ForthFault instead.
export interface RunResult {
  readonly output: string
  readonly throwCode: number | null
  readonly stack: ReadonlyArray<number>
}

// §I.lib: one dictionary entry for the inspector pane.
export interface WordInfo {
  readonly name: string
  readonly immediate: boolean
  readonly hidden: boolean
}

export class Forth {
  readonly mem: Memory
  readonly regs: Registers
  readonly dstack: Stack
  readonly rstack: Stack
  readonly inner: Inner
  readonly dict: Dictionary
  // Output sink for IO primitives (. .s emit cr type ...). The outer interpreter
  // (§T.7) drains this into RunResult.output.
  output = ''

  // Routine indices for the inner-interpreter behaviors, kept for compiling colon
  // words and CREATE-class headers later (§T.9). Assigned by boot().
  docolIndex = 0
  exitIndex = 0
  dovarIndex = 0
  doconstIndex = 0
  dodoesIndex = 0

  // XTs (CFA addresses) of the compile-support words, captured at install so the
  // compiler can append them into threads (§T.9). Must be xts, not routine indices.
  litXt = 0
  branchXt = 0
  qbranchXt = 0
  exitXt = 0
  doXt = 0
  loopXt = 0
  plusLoopXt = 0
  qDoXt = 0
  dodoesXt = 0
  sQuoteXt = 0
  dotQuoteXt = 0

  // BASE is a real memory cell (authentic: `base @` / `base !` work), NOT a JS
  // register. baseAddr is its PFA, cached at install. Single source of truth for the
  // numeric base; decimal/hex/./u./.s/parseNumber all read it.
  baseAddr = 0

  constructor(config: ForthConfig = {}) {
    this.mem = new Memory(config.memSize)
    this.regs = makeRegisters()
    this.dstack = makeDataStack(this.regs, config.stackCells)
    this.rstack = makeReturnStack(this.regs, config.stackCells)
    // Dictionary reserves the addr-0 boot cell FIRST (sole owner).
    this.dict = new Dictionary(this.mem, this.regs)
    // Inner writes HALT into the reserved boot cell (never allots).
    this.inner = new Inner(this.mem, this.regs, this.dstack, this.rstack, config.stepBudget)
    this.boot()
  }

  // Register the inner behaviors, install every primitive, and load the Forth prelude.
  // Called at construction and by reset(); code[] already holds just HALT (index 0).
  private boot(): void {
    this.docolIndex = this.inner.addRoutine(DOCOL)
    this.exitIndex = this.inner.addRoutine(EXIT)
    this.dovarIndex = this.inner.addRoutine(DOVAR)
    this.doconstIndex = this.inner.addRoutine(DOCONST)
    this.dodoesIndex = this.inner.addRoutine(DODOES)
    installPrimitives(this)
    this.loadPrelude()
  }

  // §V.16: interpret the prelude at boot; it must complete with throwCode==null.
  // A throw here is a build/prelude defect, not a user error, so it is fatal (a
  // ForthFault), never a silent half-initialized VM.
  private loadPrelude(): void {
    const result = this.interpret(PRELUDE)
    if (result.throwCode !== null) {
      throw new ForthFault(
        `prelude failed to load (throw ${result.throwCode}): ${result.output.trim()}`,
      )
    }
    this.output = '' // discard prelude output; user runs start clean
  }

  // Register a JS primitive: routine + dictionary header + CFA cell = routine index.
  // Returns the xt (CFA address).
  definePrimitive(name: string, routine: Routine, immediate = false): number {
    const index = this.inner.addRoutine(routine)
    const cfa = this.dict.header(name, immediate)
    this.mem.setCell(cfa, index)
    return cfa
  }

  emit(text: string): void {
    this.output += text
  }

  // Drive one xt to completion (via the inner harness). Primitives may ForthThrow.
  execute(xt: number): void {
    this.inner.execute(xt)
  }

  // Append one cell to the dictionary at HERE (compile a value / xt into a thread).
  comma(value: number): number {
    const at = this.mem.allot(CELL)
    this.mem.setCell(at, value)
    return at
  }

  // Current numeric base, read from the BASE memory cell (single source of truth).
  base(): number {
    return this.mem.cellAt(this.baseAddr)
  }

  // §V.15: guard a compile-only word. Throws -14 if run outside compile state.
  compileOnly(): void {
    if (this.regs.state !== STATE_COMPILE) {
      throw new ForthThrow(THROW_COMPILE_ONLY, 'compile-only word')
    }
  }

  // The bare token loop over the current source/>IN: parse a word, execute or compile
  // it (or a number), until the source is exhausted. NO try/catch here (§V.18): a
  // ForthThrow must propagate through so EVALUATE's errors reach the nearest CATCH or
  // the top-level handler, rather than being swallowed. interpret() wraps this with
  // the source/output setup + the abort-on-throw handler; evaluate() reuses it over a
  // temporary source with saved/restored parse state.
  private runTokens(): void {
    for (;;) {
      const name = this.parseName()
      if (name === null) break
      const found = this.dict.find(name)
      if (found) {
        // §V.11 compile semantics: in compile state, non-immediate words are appended
        // to the current definition; immediate words run now.
        if (this.regs.state === STATE_COMPILE && !found.immediate) {
          this.comma(found.xt)
        } else {
          this.execute(found.xt)
        }
      } else {
        const n = this.parseNumber(name)
        if (n === null) {
          throw new ForthThrow(THROW_UNDEFINED_WORD, name)
        }
        if (this.regs.state === STATE_COMPILE) {
          // Compile a literal: lit reads the next inline cell at run time.
          this.comma(this.litXt)
          this.comma(n)
        } else {
          this.dstack.push(n)
        }
      }
    }
  }

  // §V.18: run the counted string ( c-addr u ) as Forth source via a nested
  // text-interpret (a §V.1 carve-out). Reads the bytes into a JS string, then reuses
  // runTokens() over it with the enclosing parse state saved and restored so the
  // caller's tokenizing resumes cleanly. Does NOT call the public interpret() (which
  // wipes output + resets source/>IN). Output accumulates (not wiped, not saved), and
  // dsp/rsp/state are deliberately NOT saved: the evaluated text's stack results and
  // any definitions it makes must stand (authentic EVALUATE). The harness needs no
  // save (constant addr; cell-0 dead, cell-1 always HALT_XT), same as catch (§V.17).
  // A ForthThrow propagates to the caller (nearest CATCH / top level); try/finally
  // restores parse state on both paths without swallowing.
  evaluate(addr: number, len: number): void {
    let text = ''
    for (let i = 0; i < len; i++) text += String.fromCharCode(this.mem.byteAt(addr + i))
    const savedIp = this.regs.ip
    const savedW = this.regs.w
    const savedRunning = this.regs.running
    const savedSource = this.regs.source
    const savedToIn = this.regs.toIn
    try {
      this.regs.source = text
      this.regs.toIn = 0
      this.runTokens()
    } finally {
      this.regs.ip = savedIp
      this.regs.w = savedW
      this.regs.running = savedRunning
      this.regs.source = savedSource
      this.regs.toIn = savedToIn
    }
  }

  // --- Outer interpreter (text interpreter / QUIT), §T.7 ---

  // Skip whitespace, collect to the next whitespace, advance >IN. Null at end.
  parseName(): string | null {
    const src = this.regs.source
    let i = this.regs.toIn
    while (i < src.length && isSpace(src.charCodeAt(i))) i++
    if (i >= src.length) {
      this.regs.toIn = i
      return null
    }
    const start = i
    while (i < src.length && !isSpace(src.charCodeAt(i))) i++
    this.regs.toIn = i
    return src.slice(start, i)
  }

  // Collect up to `delim` (not skipping leading space), advance past it. Used by
  // ( ) comments and string words. Returns the text between >IN and the delimiter.
  parse(delim: string): string {
    const src = this.regs.source
    const code = delim.charCodeAt(0)
    const start = this.regs.toIn
    let i = start
    while (i < src.length && src.charCodeAt(i) !== code) i++
    const text = src.slice(start, i)
    this.regs.toIn = i < src.length ? i + 1 : i // step past the delimiter if present
    return text
  }

  // Parse a signed integer in the current BASE, honoring a `$` hex prefix and a
  // leading sign. Returns null if the token is not a valid number.
  parseNumber(token: string): number | null {
    if (token.length === 0) return null
    let base = this.base()
    let s = token
    let sign = 1
    if (s.startsWith('-')) {
      sign = -1
      s = s.slice(1)
    } else if (s.startsWith('+')) {
      s = s.slice(1)
    }
    if (s.startsWith('$')) {
      base = 16
      s = s.slice(1)
    }
    if (s.length === 0) return null
    let value = 0
    for (let i = 0; i < s.length; i++) {
      const digit = digitValue(s.charCodeAt(i))
      if (digit < 0 || digit >= base) return null
      value = value * base + digit
    }
    return (sign * value) | 0
  }

  // §I.lib: interpret a whole source buffer, returning a RunResult. Forth errors do
  // not throw out of here; they are caught, and (in §T.8) printed + ABORTed. Genuine
  // VM faults (ForthFault) propagate as exceptions (§V.5). §T.7 uses a stub catch
  // that records the code and returns; §T.8 fills abort()/messages.
  interpret(source: string): RunResult {
    this.regs.source = source
    this.regs.toIn = 0
    this.output = ''
    try {
      this.runTokens()
      return { output: this.output, throwCode: null, stack: this.stackSnapshot() }
    } catch (e) {
      if (e instanceof ForthThrow) {
        // §V.10: print a gforth-style message, ABORT (clear both stacks + state),
        // stop processing the rest of the buffer, and return. Forth errors never
        // leak as JS exceptions (§V.5).
        this.output += messageFor(e.code, e.detail)
        this.abort()
        return { output: this.output, throwCode: e.code, stack: this.stackSnapshot() }
      }
      throw e // ForthFault or any genuine VM fault -> Effect E-channel (§V.5)
    }
  }

  // §V.10: clear the data AND return stacks, reset STATE to interpret, stop the
  // trampoline. Resetting rsp is load-bearing: a ForthThrow unwinds the JS stack
  // without running pending EXITs, so rsp is left dirty mid-colon (§B.1).
  abort(): void {
    this.regs.dsp = 0
    this.regs.rsp = 0
    this.regs.running = false
    this.regs.state = STATE_INTERPRET
  }

  // §I.lib: a COPY of the live data stack (§V.4), bottom-to-top.
  stackSnapshot(): ReadonlyArray<number> {
    const depth = this.regs.dsp
    const out = new Array<number>(depth)
    for (let i = 0; i < depth; i++) out[i] = this.dstack.cells[i] as number
    return out
  }

  // §I.lib: dictionary entries newest-first, for the inspector pane.
  dictSnapshot(): ReadonlyArray<WordInfo> {
    const out: Array<WordInfo> = []
    let link = this.regs.latest
    while (link !== 0) {
      const lenflags = this.mem.byteAt(link + LENFLAGS_OFFSET)
      const len = lenflags & NAME_LEN_MASK
      let name = ''
      for (let i = 0; i < len; i++) {
        name += String.fromCharCode(this.mem.byteAt(link + NAME_OFFSET + i))
      }
      out.push({
        name,
        immediate: (lenflags & FLAG_IMMEDIATE) !== 0,
        hidden: (lenflags & FLAG_HIDDEN) !== 0,
      })
      link = this.mem.cellAt(link)
    }
    return out
  }

  // §I.lib: reset the VM to a fresh boot state (re-installs primitives).
  reset(): void {
    this.regs.dsp = 0
    this.regs.rsp = 0
    this.regs.state = STATE_INTERPRET
    // BASE is a memory cell, recreated by installPrimitives during the reboot below.
    this.regs.toIn = 0
    this.regs.latest = 0
    this.regs.running = false
    this.mem.here = 0
    this.output = ''
    // Re-run the boot sequence: reset code[] to just HALT, reserve the addr-0 boot
    // cell (Dictionary owns it), then re-register behaviors + primitives.
    this.inner.installHalt()
    this.dict.reserveBootCell()
    this.boot()
  }
}

const isSpace = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d

// ASCII digit value: 0-9 -> 0-9, A-Z/a-z -> 10-35. -1 if not a digit char.
const digitValue = (c: number): number => {
  if (c >= 0x30 && c <= 0x39) return c - 0x30
  if (c >= 0x41 && c <= 0x5a) return c - 0x41 + 10
  if (c >= 0x61 && c <= 0x7a) return c - 0x61 + 10
  return -1
}

// Install the Core + Extended primitive word-set (§I.forth). The definitions live in
// primitives/*.ts, one install fn per contiguous group; forth.ts calls them here in
// the original definition order. Higher-level words come from the prelude (§T.10).
// Each primitive raises its own throws (div0 -10, etc.); catching is the outer
// interpreter's job (§T.7/§T.8). Only the BASE block (in installCore) and the *Xt
// captures run at install time; all must complete before loadPrelude().
const installPrimitives = (f: Forth): void => {
  installCore(f) // stack / arithmetic / logic / return stack / memory / IO / BASE
  installRuntimes(f) // lit / branch / ?branch / (do) / (loop) / (+loop) / (?do) / (s") / (.")
  installDefiningState(f) // : ; [ ] immediate literal ' [']
  installControlFlow(f) // if..then, begin..until/again/while..repeat, do/?do..loop/+loop, comments
  installDataDefining(f) // variable / constant / create / does> / (does>) / >body
  installExtended(f) // evaluate, strings (char [char] s" ."), system (bye throw abort), catch
  installExit(f) // exit — last, so f.exitXt is set before any thread compiles ;
}
