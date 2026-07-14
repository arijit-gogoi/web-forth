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
import { ForthThrow, THROW_DIV_ZERO, THROW_UNDEFINED_WORD } from './errors'
import { DOCOL, DOCONST, DOVAR, EXIT, Inner, type Routine } from './inner'
import { CELL, Memory } from './memory'
import { messageFor, THROW_ABORT } from './messages'
import { makeRegisters, STATE_INTERPRET, type Registers } from './registers'
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

  // Register the inner behaviors and install every primitive. Called at construction
  // and by reset(); code[] already holds just HALT (index 0) at this point.
  private boot(): void {
    this.docolIndex = this.inner.addRoutine(DOCOL)
    this.exitIndex = this.inner.addRoutine(EXIT)
    this.dovarIndex = this.inner.addRoutine(DOVAR)
    this.doconstIndex = this.inner.addRoutine(DOCONST)
    installPrimitives(this)
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
    let base = this.regs.base
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
          this.execute(found.xt)
        } else {
          const n = this.parseNumber(name)
          if (n === null) {
            throw new ForthThrow(THROW_UNDEFINED_WORD, name)
          }
          this.dstack.push(n)
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
    this.regs.base = 10
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

// Install the v1 primitive word-set (§I.forth). Higher-level words come from the
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

  // --- I/O (output only, v1) ---
  def('.', () => {
    f.emit(`${formatSigned(d.pop(), f.regs.base)} `)
  })
  def('u.', () => {
    f.emit(`${formatUnsigned(d.pop(), f.regs.base)} `)
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
  def('.s', () => {
    // Non-destructive stack print: <n> a b c
    const depth = f.regs.dsp
    let s = `<${depth}> `
    for (let i = 0; i < depth; i++) {
      s += `${(f.dstack.cells[i] as number).toString(f.regs.base)} `
    }
    f.emit(s)
  })

  // --- Numeric base ---
  def('decimal', () => {
    f.regs.base = 10
  })
  def('hex', () => {
    f.regs.base = 16
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
}
