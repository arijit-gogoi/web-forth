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

// The Core word-set, in definition order. installCore() is the orchestrator; the
// sub-fns are split only to keep each under the unit-size threshold and must stay
// called in this exact order (byte-identical dictionary keeps the golden suite green).
export const installCore = (f: Forth): void => {
  installStack(f)
  installArithmetic(f)
  installArithShift(f)
  installCompareLogic(f)
  installReturnStack(f)
  installMemory(f)
  installIO(f)
  installBase(f)
}

// --- Stack ---
const installStack = (f: Forth): void => {
  const d = f.dstack
  const def = makeDef(f)

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
  // depth ( -- n ) : the number of cells on the data stack BEFORE depth ran. dsp is
  // the live count; depth has not pushed yet, so dsp is exactly that count (§V.29).
  def('depth', () => {
    d.push(f.regs.dsp)
  })
  // 2swap ( a b c d -- c d a b ) : swap the top two cell pairs.
  def('2swap', () => {
    const dd = d.pop()
    const c = d.pop()
    const b = d.pop()
    const a = d.pop()
    d.push(c)
    d.push(dd)
    d.push(a)
    d.push(b)
  })
  // 2over ( a b c d -- a b c d a b ) : copy the second pair over the first.
  def('2over', () => {
    const dd = d.pop()
    const c = d.pop()
    const b = d.pop()
    const a = d.pop()
    d.push(a)
    d.push(b)
    d.push(c)
    d.push(dd)
    d.push(a)
    d.push(b)
  })
}

// --- Arithmetic ---
const installArithmetic = (f: Forth): void => {
  const d = f.dstack
  const def = makeDef(f)

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
}

// --- Shift / scale (§V.29: logical vs arithmetic, wide */). Split from the basic
// arithmetic group to keep each install fn under the unit-size floor; installCore
// calls them back to back so the dictionary stays byte-identical. ---
const installArithShift = (f: Forth): void => {
  const d = f.dstack
  const def = makeDef(f)

  // 2* ( n -- 2n ) : arithmetic left shift by one.
  def('2*', () => {
    d.push(d.pop() << 1)
  })
  // 2/ ( n -- n/2 ) : arithmetic right shift by one, sign-preserving (§V.29): -4 2/
  // is -2, not a huge unsigned value. Distinct from rshift (which is logical).
  def('2/', () => {
    d.push(d.pop() >> 1)
  })
  // lshift ( x u -- x<<u ) : logical left shift by u bits.
  def('lshift', () => {
    const u = d.pop()
    d.push(d.pop() << u)
  })
  // rshift ( x u -- x>>>u ) : LOGICAL (zero-fill) right shift by u bits (§V.29): the
  // ANS rshift ignores the sign bit, so -1 1 rshift is 0x7fffffff, not -1. This is
  // why 2/ (arithmetic) and rshift (logical) are separate words.
  def('rshift', () => {
    const u = d.pop()
    d.push(d.pop() >>> u)
  })
  // */ ( a b c -- a*b/c ) : scale with a WIDE intermediate (§V.29). Compute a*b at
  // full precision (BigInt) BEFORE dividing, so it does not truncate to 32 bits the
  // way `* /` would (Math.imul wraps a*b, defeating the point of the word). div-by-0
  // throws -10 (§V.9).
  def('*/', () => {
    const c = d.pop()
    const b = d.pop()
    const a = d.pop()
    if (c === 0) throw new ForthThrow(THROW_DIV_ZERO, 'division by zero')
    d.push(Number((BigInt(a) * BigInt(b)) / BigInt(c)) | 0)
  })
  // */mod ( a b c -- rem quot ) : like */ but also leaves the remainder, both from
  // the same wide a*b product (§V.29). Symmetric (truncated) division, matching /mod.
  def('*/mod', () => {
    const c = d.pop()
    const b = d.pop()
    const a = d.pop()
    if (c === 0) throw new ForthThrow(THROW_DIV_ZERO, 'division by zero')
    const p = BigInt(a) * BigInt(b)
    const bc = BigInt(c)
    d.push(Number(p % bc) | 0) // remainder
    d.push(Number(p / bc) | 0) // quotient
  })
}

// --- Compare / logic (Forth true = -1, false = 0) ---
const installCompareLogic = (f: Forth): void => {
  const d = f.dstack
  const def = makeDef(f)

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
  // u< ( u1 u2 -- flag ) : UNSIGNED less-than (§V.29). JS `<` is signed, so coerce
  // both to unsigned (>>> 0) first: -1 (0xffffffff) is the LARGEST unsigned, so
  // -1 1 u< is false. Precedent: u. already treats cells as unsigned.
  def('u<', () => {
    const b = d.pop()
    d.push(bool((d.pop() >>> 0) < (b >>> 0)))
  })
  // u> ( u1 u2 -- flag ) : unsigned greater-than, the mirror of u<.
  def('u>', () => {
    const b = d.pop()
    d.push(bool((d.pop() >>> 0) > (b >>> 0)))
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
}

// --- Return stack ---
const installReturnStack = (f: Forth): void => {
  const d = f.dstack
  const r = f.rstack
  const def = makeDef(f)

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
}

// --- Memory ---
const installMemory = (f: Forth): void => {
  const d = f.dstack
  const def = makeDef(f)

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
  // move ( src dst u -- ) : copy u bytes from src to dst, overlap-correct (like
  // memmove / the ANS MOVE, which acts as if through an intermediate buffer). Uses
  // the Uint8Array copyWithin, which handles overlap in both directions. A zero or
  // negative count is a no-op; bytes.copyWithin clamps out-of-range indices.
  def('move', () => {
    const u = d.pop()
    const dst = d.pop()
    const src = d.pop()
    if (u > 0) f.mem.bytes.copyWithin(dst, src, src + u)
  })
  // fill ( addr u char -- ) : set u bytes starting at addr to char (low byte).
  def('fill', () => {
    const ch = d.pop()
    const u = d.pop()
    const addr = d.pop()
    if (u > 0) f.mem.bytes.fill(ch & 0xff, addr, addr + u)
  })
}

// --- I/O (output only, Core) ---
const installIO = (f: Forth): void => {
  const d = f.dstack
  const def = makeDef(f)

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
}

// --- Numeric base (a real memory cell; base @ / base ! work) ---
const installBase = (f: Forth): void => {
  const def = makeDef(f)

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
