// @web-forth/engine — Core primitive word-set: stack, arithmetic, compare/logic,
// return stack, memory, output IO, and the numeric BASE (§I.forth). Split out of
// forth.ts for readability; forth.ts's installPrimitives() calls installCore()
// first, in the original definition order (§V has no address dependency, but a
// byte-identical dictionary keeps the golden suite trivially green).
//
// Each primitive raises its own throws (div0 -10, etc.); catching is the outer
// interpreter's job (§T.7/§T.8). No def body runs at install time except the BASE
// block, which allots cells and caches f.baseAddr before loadPrelude() needs it.

import { ForthThrow, THROW_DIV_ZERO } from '../errors'
import { CELL } from '../memory'
import type { Forth } from '../forth'
import { makeDef } from './shared'

// Forth true = -1, false = 0. Shared by every comparison/logic primitive here.
const bool = (x: boolean): number => (x ? -1 : 0)

// Format a cell value in the current BASE (signed). Used by `.`.
const formatSigned = (n: number, base: number): string => (n | 0).toString(base)

// Format a cell value as unsigned in the current BASE. Used by `u.`.
const formatUnsigned = (n: number, base: number): string => (n >>> 0).toString(base)

export const installCore = (f: Forth): void => {
  const d = f.dstack
  const r = f.rstack
  const def = makeDef(f)

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
}
