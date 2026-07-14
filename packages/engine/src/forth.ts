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
  toBody,
} from './dictionary'
import {
  ForthFault,
  ForthThrow,
  THROW_COMPILE_ONLY,
  THROW_DIV_ZERO,
  THROW_INVALID_ADDR,
  THROW_UNDEFINED_WORD,
} from './errors'
import { PRELUDE } from './prelude.generated'
import { DOCOL, DOCONST, DODOES, DOVAR, EXIT, Inner, type Routine } from './inner'
import { CELL, Memory } from './memory'
import { messageFor, THROW_ABORT } from './messages'
import {
  makeRegisters,
  STATE_COMPILE,
  STATE_INTERPRET,
  type Registers,
} from './registers'
import { makeDataStack, makeReturnStack, type Stack } from './stack'

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
      for (;;) {
        const name = this.parseName()
        if (name === null) break
        const found = this.dict.find(name)
        if (found) {
          // §V.11 compile semantics: in compile state, non-immediate words are
          // appended to the current definition; immediate words run now.
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

// Format a cell value in the current BASE (signed). Used by `.`.
const formatSigned = (n: number, base: number): string => (n | 0).toString(base)

// Format a cell value as unsigned in the current BASE. Used by `u.`.
const formatUnsigned = (n: number, base: number): string => (n >>> 0).toString(base)

// Install the Core primitive word-set (§I.forth). Higher-level words come from the
// prelude (§T.10). Each primitive raises its own throws (div0 -10, etc.); catching
// is the outer interpreter's job (§T.7/§T.8).
const installPrimitives = (f: Forth): void => {
  const d = f.dstack
  const r = f.rstack
  const def = (name: string, routine: Routine, immediate = false) =>
    f.definePrimitive(name, routine, immediate)

  // --- Stack ---
  def('dup', () => {
    const x = d.peek()
    d.push(x)
  })
  def('drop', () => {
    d.pop()
  })
  def('swap', () => {
    const b = d.pop()
    const a = d.pop()
    d.push(b)
    d.push(a)
  })
  def('over', () => {
    const b = d.pop()
    const a = d.pop()
    d.push(a)
    d.push(b)
    d.push(a)
  })
  def('rot', () => {
    const c = d.pop()
    const b = d.pop()
    const a = d.pop()
    d.push(b)
    d.push(c)
    d.push(a)
  })

  // --- Arithmetic ---
  def('+', () => {
    const b = d.pop()
    d.push(d.pop() + b)
  })
  def('-', () => {
    const b = d.pop()
    d.push(d.pop() - b)
  })
  def('*', () => {
    const b = d.pop()
    d.push(Math.imul(d.pop(), b))
  })
  // Symmetric (truncated-toward-zero) division, standard for / mod /mod.
  def('/', () => {
    const b = d.pop()
    const a = d.pop()
    if (b === 0) throw new ForthThrow(THROW_DIV_ZERO, 'division by zero')
    d.push((a / b) | 0)
  })
  def('mod', () => {
    const b = d.pop()
    const a = d.pop()
    if (b === 0) throw new ForthThrow(THROW_DIV_ZERO, 'division by zero')
    d.push((a % b) | 0)
  })
  def('/mod', () => {
    const b = d.pop()
    const a = d.pop()
    if (b === 0) throw new ForthThrow(THROW_DIV_ZERO, 'division by zero')
    d.push((a % b) | 0) // remainder
    d.push((a / b) | 0) // quotient
  })
  def('negate', () => {
    d.push(-d.pop())
  })
  def('1+', () => {
    d.push(d.pop() + 1)
  })
  def('1-', () => {
    d.push(d.pop() - 1)
  })

  // --- Compare / logic (Forth true = -1, false = 0) ---
  const bool = (x: boolean): number => (x ? -1 : 0)
  def('=', () => {
    const b = d.pop()
    d.push(bool(d.pop() === b))
  })
  def('<>', () => {
    const b = d.pop()
    d.push(bool(d.pop() !== b))
  })
  def('<', () => {
    const b = d.pop()
    d.push(bool(d.pop() < b))
  })
  def('>', () => {
    const b = d.pop()
    d.push(bool(d.pop() > b))
  })
  def('0=', () => {
    d.push(bool(d.pop() === 0))
  })
  def('0<', () => {
    d.push(bool(d.pop() < 0))
  })
  def('0>', () => {
    d.push(bool(d.pop() > 0))
  })
  def('and', () => {
    const b = d.pop()
    d.push(d.pop() & b)
  })
  def('or', () => {
    const b = d.pop()
    d.push(d.pop() | b)
  })
  def('xor', () => {
    const b = d.pop()
    d.push(d.pop() ^ b)
  })
  def('invert', () => {
    d.push(~d.pop())
  })

  // --- Return stack ---
  def('>r', () => {
    r.push(d.pop())
  })
  def('r>', () => {
    d.push(r.pop())
  })
  def('r@', () => {
    d.push(r.peek())
  })
  // i ( -- n ) : innermost DO loop index = return-stack top (§V.22). (do)/(?do)
  // push [limit, index], so index is the top cell. i is a primitive (no DOCOL),
  // so no return address sits above the index when it runs inside the loop body.
  def('i', () => {
    d.push(r.peek())
  })
  // j ( -- n ) : next-outer DO loop index (§V.22). Return stack top-down is
  // [index_inner, limit_inner, index_outer, limit_outer], so index_outer is 3
  // cells below the top (rsp-3).
  def('j', () => {
    d.push(r.cells[f.regs.rsp - 3] as number)
  })

  // --- Memory ---
  def('@', () => {
    d.push(f.mem.cellAt(d.pop()))
  })
  def('!', () => {
    const addr = d.pop()
    const val = d.pop()
    f.mem.setCell(addr, val)
  })
  def('c@', () => {
    d.push(f.mem.byteAt(d.pop()))
  })
  def('c!', () => {
    const addr = d.pop()
    const val = d.pop()
    f.mem.setByte(addr, val)
  })
  def('+!', () => {
    const addr = d.pop()
    const delta = d.pop()
    f.mem.setCell(addr, f.mem.cellAt(addr) + delta)
  })
  def(',', () => {
    const at = f.mem.allot(CELL)
    f.mem.setCell(at, d.pop())
  })
  def('here', () => {
    d.push(f.mem.here)
  })
  def('allot', () => {
    f.mem.allot(d.pop())
  })
  def('cells', () => {
    d.push(d.pop() * CELL)
  })
  def('cell+', () => {
    d.push(d.pop() + CELL)
  })
  def('align', () => {
    f.mem.align()
  })
  def('aligned', () => {
    const a = d.pop()
    const rem = a & (CELL - 1)
    d.push(rem === 0 ? a : a + (CELL - rem))
  })

  // --- I/O (output only, Core) ---
  def('.', () => {
    f.emit(`${formatSigned(d.pop(), f.base())} `)
  })
  def('u.', () => {
    f.emit(`${formatUnsigned(d.pop(), f.base())} `)
  })
  def('emit', () => {
    f.emit(String.fromCharCode(d.pop() & 0xff))
  })
  def('cr', () => {
    f.emit('\n')
  })
  def('space', () => {
    f.emit(' ')
  })
  // type ( addr len -- ) : print len bytes starting at addr.
  def('type', () => {
    const len = d.pop()
    const addr = d.pop()
    let s = ''
    for (let i = 0; i < len; i++) s += String.fromCharCode(f.mem.byteAt(addr + i))
    f.emit(s)
  })
  def('.s', () => {
    // Non-destructive stack print: <n> a b c
    const depth = f.regs.dsp
    const base = f.base()
    let s = `<${depth}> `
    for (let i = 0; i < depth; i++) {
      s += `${(f.dstack.cells[i] as number).toString(base)} `
    }
    f.emit(s)
  })

  // --- Numeric base (a real memory cell; base @ / base ! work) ---
  // Create BASE as a CREATE-class variable, cache its PFA, initialize to 10. This
  // runs before loadPrelude() (whose literals need BASE=10 already set).
  {
    const cfa = f.dict.header('base')
    f.mem.setCell(cfa, f.dovarIndex)
    f.comma(0) // doesCodeAddr slot (2-slot CREATE layout, §V.11)
    f.baseAddr = f.comma(10) // body cell = the base value, default decimal
  }
  def('decimal', () => {
    f.mem.setCell(f.baseAddr, 10)
  })
  def('hex', () => {
    f.mem.setCell(f.baseAddr, 16)
  })

  // --- Compile-support runtime words (compiled into threads by the immediates) ---
  // lit: push the next inline cell and step ip past it.
  f.litXt = def('lit', (v) => {
    v.dstack.push(v.mem.cellAt(v.regs.ip))
    v.regs.ip += CELL
  })
  // branch: unconditional jump; target is the next inline cell (absolute address).
  f.branchXt = def('branch', (v) => {
    v.regs.ip = v.mem.cellAt(v.regs.ip)
  })
  // ?branch: pop a flag; branch if zero (false), else skip the target cell.
  f.qbranchXt = def('?branch', (v) => {
    const flag = v.dstack.pop()
    if (flag === 0) {
      v.regs.ip = v.mem.cellAt(v.regs.ip)
    } else {
      v.regs.ip += CELL
    }
  })
  // (do): runtime of DO. ( limit index -- ) push both onto the return stack.
  f.doXt = def('(do)', (v) => {
    const index = v.dstack.pop()
    const limit = v.dstack.pop()
    v.rstack.push(limit)
    v.rstack.push(index)
  })
  // (loop): runtime of LOOP. Increment index; if index < limit, branch back to the
  // loop top (next inline cell); else drop the loop control and continue.
  f.loopXt = def('(loop)', (v) => {
    const index = v.rstack.pop() + 1
    const limit = v.rstack.pop()
    if (index < limit) {
      v.rstack.push(limit)
      v.rstack.push(index)
      v.regs.ip = v.mem.cellAt(v.regs.ip) // branch to loop top
    } else {
      v.regs.ip += CELL // skip the loop-top target, exit the loop
    }
  })
  // (+loop): runtime of +LOOP ( n -- ). Add n to the index; loop again unless the
  // step crossed the limit boundary (§V.22). Boundary crossing = the sign of
  // (index-limit) flips between before and after; this handles negative steps that
  // plain (loop)'s index<limit cannot. gforth's test: ((old-limit) XOR (new-limit)) < 0.
  f.plusLoopXt = def('(+loop)', (v) => {
    const step = v.dstack.pop()
    const index = v.rstack.pop()
    const limit = v.rstack.pop()
    const next = (index + step) | 0
    const crossed = ((index - limit) ^ (next - limit)) < 0
    if (!crossed) {
      v.rstack.push(limit)
      v.rstack.push(next)
      v.regs.ip = v.mem.cellAt(v.regs.ip) // branch to loop top
    } else {
      v.regs.ip += CELL // exit the loop
    }
  })
  // (?do): runtime of ?DO ( limit index -- ). Like (do), but if limit==index the
  // loop body is empty, so jump past it to the resolved skip target (§V.22). The
  // skip target is the next inline cell (resolved by loop/+loop to just-after-loop).
  f.qDoXt = def('(?do)', (v) => {
    const index = v.dstack.pop()
    const limit = v.dstack.pop()
    if (limit === index) {
      v.regs.ip = v.mem.cellAt(v.regs.ip) // skip the (empty) loop entirely
    } else {
      v.rstack.push(limit)
      v.rstack.push(index)
      v.regs.ip += CELL // step past the skip-target cell into the body
    }
  })

  // --- Defining + state words ---
  // : ( "name" -- ) create a colon header (CFA=DOCOL), smudge it, enter compile.
  def(':', () => {
    const name = f.parseName()
    if (name === null) throw new ForthThrow(THROW_UNDEFINED_WORD, ':')
    const cfa = f.dict.header(name)
    f.mem.setCell(cfa, f.docolIndex)
    f.dict.setHidden(f.regs.latest, true) // hide until ; (§V.11)
    f.regs.state = STATE_COMPILE
  })
  // ; (immediate, compile-only) compile EXIT, reveal the word, leave compile.
  def(
    ';',
    () => {
      f.compileOnly() // §V.15
      f.comma(f.exitXt)
      f.dict.setHidden(f.regs.latest, false)
      f.regs.state = STATE_INTERPRET
    },
    true,
  )
  // [ (immediate) leave compile; ] enter compile.
  def(
    '[',
    () => {
      f.regs.state = STATE_INTERPRET
    },
    true,
  )
  def(']', () => {
    f.regs.state = STATE_COMPILE
  })
  // immediate: mark the latest word immediate.
  def('immediate', () => {
    f.dict.setImmediate(f.regs.latest, true)
  })
  // literal (immediate, compile-only) ( n -- ) : compile n as an inline literal.
  def(
    'literal',
    () => {
      f.compileOnly()
      f.comma(f.litXt)
      f.comma(d.pop())
    },
    true,
  )
  // ' ( "name" -- xt ) : push the xt of the next word (interpret-time tick).
  def("'", () => {
    const name = f.parseName()
    if (name === null) throw new ForthThrow(THROW_UNDEFINED_WORD, "'")
    const found = f.dict.find(name)
    if (found === null) throw new ForthThrow(THROW_UNDEFINED_WORD, name)
    d.push(found.xt)
  })
  // ['] (immediate, compile-only) ( "name" -- ) : compile the next word's xt as a literal.
  def(
    "[']",
    () => {
      f.compileOnly()
      const name = f.parseName()
      if (name === null) throw new ForthThrow(THROW_UNDEFINED_WORD, "[']")
      const found = f.dict.find(name)
      if (found === null) throw new ForthThrow(THROW_UNDEFINED_WORD, name)
      f.comma(f.litXt)
      f.comma(found.xt)
    },
    true,
  )

  // --- Control-flow immediates (compile-only; §V.15). Backpatch targets are
  // absolute addresses, kept on the data stack during compilation. ---
  // if: compile ?branch + a placeholder target; push the placeholder's address.
  def(
    'if',
    () => {
      f.compileOnly()
      f.comma(f.qbranchXt)
      d.push(f.comma(0)) // reserve target cell; leave its addr for then/else
    },
    true,
  )
  // else: compile branch + placeholder; resolve if's target to here; push new addr.
  def(
    'else',
    () => {
      f.compileOnly()
      f.comma(f.branchXt)
      const elseSlot = f.comma(0)
      const ifSlot = d.pop()
      f.mem.setCell(ifSlot, f.mem.here) // if jumps here when false
      d.push(elseSlot)
    },
    true,
  )
  // then: resolve the pending target (if or else) to here.
  def(
    'then',
    () => {
      f.compileOnly()
      const slot = d.pop()
      f.mem.setCell(slot, f.mem.here)
    },
    true,
  )
  // begin: push here (loop top) for until/again.
  def(
    'begin',
    () => {
      f.compileOnly()
      d.push(f.mem.here)
    },
    true,
  )
  // until: compile ?branch back to the begin target (loops while flag is false).
  def(
    'until',
    () => {
      f.compileOnly()
      f.comma(f.qbranchXt)
      f.comma(d.pop())
    },
    true,
  )
  // again: compile an unconditional branch back to begin (infinite loop).
  def(
    'again',
    () => {
      f.compileOnly()
      f.comma(f.branchXt)
      f.comma(d.pop())
    },
    true,
  )
  // while ( -- ) (compile-only) : inside begin ... while ... repeat. Compile
  // ?branch + a forward exit target; push its slot ABOVE the begin address so
  // repeat can resolve it. Stack: [beginAddr] -> [beginAddr, whileSlot].
  def(
    'while',
    () => {
      f.compileOnly()
      f.comma(f.qbranchXt)
      const beginAddr = d.pop()
      const whileSlot = f.comma(0)
      d.push(beginAddr)
      d.push(whileSlot)
    },
    true,
  )
  // repeat ( -- ) (compile-only) : branch back to begin, then resolve while's
  // forward exit to here (loop exit). Stack: [beginAddr, whileSlot] -> [].
  def(
    'repeat',
    () => {
      f.compileOnly()
      const whileSlot = d.pop()
      f.comma(f.branchXt)
      f.comma(d.pop()) // branch target = beginAddr
      f.mem.setCell(whileSlot, f.mem.here) // while exits here when flag is false
    },
    true,
  )
  // Loop compile-stack convention (§V.22): every DO-class opener leaves TWO cells
  // for the closer: [skipSlot, loopTop]. skipSlot is the forward-branch target that
  // ?do resolves to just-past-the-loop; plain do uses the 0 sentinel (nothing to
  // resolve). loop/+loop pop loopTop, compile the runtime + loop-top target, then
  // resolve skipSlot if non-zero. This keeps one closer path for do and ?do.
  // do: compile (do); no skip slot (sentinel 0); push loop top.
  def(
    'do',
    () => {
      f.compileOnly()
      f.comma(f.doXt)
      d.push(0) // skipSlot sentinel: plain do has no forward target
      d.push(f.mem.here) // loop top
    },
    true,
  )
  // ?do: compile (?do) + a forward skip-target cell; push [skipSlot, loopTop].
  def(
    '?do',
    () => {
      f.compileOnly()
      f.comma(f.qDoXt)
      d.push(f.comma(0)) // skipSlot: (?do) reads it; loop resolves it past the loop
      d.push(f.mem.here) // loop top
    },
    true,
  )
  // loop: compile (loop) + loop-top target; resolve the ?do skip slot to here.
  def(
    'loop',
    () => {
      f.compileOnly()
      const loopTop = d.pop()
      f.comma(f.loopXt)
      f.comma(loopTop)
      const skipSlot = d.pop()
      if (skipSlot !== 0) f.mem.setCell(skipSlot, f.mem.here)
    },
    true,
  )
  // +loop: like loop but compiles (+loop) (signed step, boundary-crossing exit).
  def(
    '+loop',
    () => {
      f.compileOnly()
      const loopTop = d.pop()
      f.comma(f.plusLoopXt)
      f.comma(loopTop)
      const skipSlot = d.pop()
      if (skipSlot !== 0) f.mem.setCell(skipSlot, f.mem.here)
    },
    true,
  )

  // --- Comments (Core-required: the prelude needs them readable, §02) ---
  // ( ... ) immediate: parse to the closing paren, discard.
  def(
    '(',
    () => {
      f.parse(')')
    },
    true,
  )
  // \ immediate: skip to end of line.
  def(
    '\\',
    () => {
      f.parse('\n')
    },
    true,
  )

  // --- Defining words for data (CREATE-class; DOES> is Extended, §V.11) ---
  // variable ( "name" -- ) : CFA=[DOVAR][doesCodeAddr=0][body cell]. Pushes PFA.
  def('variable', () => {
    const name = f.parseName()
    if (name === null) throw new ForthThrow(THROW_UNDEFINED_WORD, 'variable')
    const cfa = f.dict.header(name)
    f.mem.setCell(cfa, f.dovarIndex)
    f.comma(0) // doesCodeAddr slot (2-slot layout, §V.11)
    f.comma(0) // one body cell, initialized to 0
  })
  // constant ( n "name" -- ) : CFA=[DOCONST][value]. Pushes the stored value.
  def('constant', () => {
    const name = f.parseName()
    if (name === null) throw new ForthThrow(THROW_UNDEFINED_WORD, 'constant')
    const value = d.pop()
    const cfa = f.dict.header(name)
    f.mem.setCell(cfa, f.doconstIndex)
    f.comma(value)
  })

  // --- CREATE / DOES> / >BODY (Extended, §V.11, §V.24) ---
  // create ( "name" -- ) : CFA=[DOVAR][doesCodeAddr=0], no body cells (allot on
  // demand). Same 2-slot layout as variable so DOES> and >BODY slot in. Pushing
  // the PFA is DOVAR's job; DOES> later rewrites the CFA routine to DODOES.
  def('create', () => {
    const name = f.parseName()
    if (name === null) throw new ForthThrow(THROW_UNDEFINED_WORD, 'create')
    const cfa = f.dict.header(name)
    f.mem.setCell(cfa, f.dovarIndex)
    f.comma(0) // doesCodeAddr slot (2-slot layout, §V.11); 0 until DOES> sets it
  })
  // does> (immediate, compile-only) : end the defining word's pre-DOES> part by
  // compiling (does>), then let the DOES> code fall through as an inline thread.
  // At the defining word's runtime, (does>) patches the just-created word.
  def(
    'does>',
    () => {
      f.compileOnly()
      f.comma(f.dodoesXt) // compile the (does>) runtime marker
    },
    true,
  )
  // (does>) runtime: executed while the defining word runs, right after it has
  // CREATEd the child. Point the child's CFA routine at DODOES and its
  // doesCodeAddr slot at the code right after this marker (the DOES> thread),
  // then EXIT the defining word so the DOES> code does not run at define time.
  f.dodoesXt = def('(does>)', (v) => {
    const childCfa = f.dict.cfaOf(v.regs.latest)
    v.mem.setCell(childCfa, f.dodoesIndex) // child now behaves as DODOES
    v.mem.setCell(childCfa + CELL, v.regs.ip) // doesCodeAddr -> DOES> thread start
    v.regs.ip = v.rstack.pop() // EXIT the defining word
  })
  // >body ( xt -- pfa ) : parameter field of a CREATE-class word (CFA+2*CELL,
  // §V.11). §V.24: only valid for CREATE-class words (CFA routine DOVAR|DODOES);
  // a colon/constant/primitive xt has no such body -> THROW -9.
  def('>body', () => {
    const cfa = d.pop()
    const routine = f.mem.cellAt(cfa)
    if (routine !== f.dovarIndex && routine !== f.dodoesIndex) {
      throw new ForthThrow(THROW_INVALID_ADDR, '>body on a non-CREATE word')
    }
    d.push(toBody(cfa))
  })

  // --- System ---
  def('bye', () => {
    f.regs.running = false
  })
  // throw ( code -- ) : 0 is a no-op; non-zero unwinds to the top-level handler.
  def('throw', () => {
    const code = d.pop()
    if (code !== 0) throw new ForthThrow(code)
  })
  // abort ( -- ) : unconditional THROW -1.
  def('abort', () => {
    throw new ForthThrow(THROW_ABORT)
  })

  // Capture EXIT's xt for ; to compile. EXIT the word (distinct from the routine).
  f.exitXt = def('exit', EXIT)
}
