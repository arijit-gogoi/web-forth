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

import { Dictionary } from './dictionary'
import { ForthThrow, THROW_DIV_ZERO } from './errors'
import { DOCOL, DOCONST, DOVAR, EXIT, Inner, type Routine } from './inner'
import { CELL, Memory } from './memory'
import { makeRegisters, type Registers } from './registers'
import { makeDataStack, makeReturnStack, type Stack } from './stack'

export interface ForthConfig {
  readonly memSize?: number
  readonly stackCells?: number
  readonly stepBudget?: number
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
  // words and CREATE-class headers later (§T.9).
  readonly docolIndex: number
  readonly exitIndex: number
  readonly dovarIndex: number
  readonly doconstIndex: number

  constructor(config: ForthConfig = {}) {
    this.mem = new Memory(config.memSize)
    this.regs = makeRegisters()
    this.dstack = makeDataStack(this.regs, config.stackCells)
    this.rstack = makeReturnStack(this.regs, config.stackCells)
    // Dictionary reserves the addr-0 boot cell FIRST (sole owner).
    this.dict = new Dictionary(this.mem, this.regs)
    // Inner writes HALT into the reserved boot cell (never allots).
    this.inner = new Inner(this.mem, this.regs, this.dstack, this.rstack, config.stepBudget)

    // Register the inner behaviors so colon/CREATE headers can name them.
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
}
