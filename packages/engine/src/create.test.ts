// CREATE / DOES> / >BODY + DODOES (SPEC §T.20, §V.11, §V.24). The classic
// authenticity test: a defining word built from CREATE ... DOES> gives its
// children run-time behavior threaded from the DOES> code, with the PFA on the
// stack. >BODY exposes the 2-slot layout and rejects non-CREATE words (§V.24).

import { describe, expect, test } from 'vitest'
import { DODOES } from './inner'
import { Forth } from './forth'
import { CELL } from './memory'

describe('CREATE (§V.11 2-slot layout)', () => {
  test('create makes a word that pushes its PFA', () => {
    const f = new Forth()
    f.interpret('create x')
    const xt = f.dict.find('x')!.xt
    // CFA routine is DOVAR (like variable); PFA is CFA + 2*CELL.
    expect(f.mem.cellAt(xt)).toBe(f.dovarIndex)
    expect(f.interpret('x').stack).toEqual([xt + 2 * CELL])
  })

  test('create then , builds a table read back through the PFA', () => {
    const f = new Forth()
    // create p 1 , 2 ,  -> p @ = 1, p cell+ @ = 2
    const r = f.interpret('create p 1 , 2 , p @ p cell+ @')
    expect(r.stack).toEqual([1, 2])
    expect(r.throwCode).toBeNull()
  })
})

describe('DOES> (§V.11 DODOES threads into the DOES> code)', () => {
  test('constant-via-does>: 42 const answer -> 42', () => {
    const f = new Forth()
    // : const create , does> @ ;   builds words that push a stored value
    f.interpret(': const create , does> @ ;')
    f.interpret('42 const answer')
    // the child now behaves as DODOES
    const xt = f.dict.find('answer')!.xt
    expect(f.mem.cellAt(xt)).toBe(f.dodoesIndex)
    expect(f.interpret('answer').stack).toEqual([42])
  })

  test('DODOES routine is registered and matches dodoesIndex', () => {
    const f = new Forth()
    expect(f.inner.code[f.dodoesIndex]).toBe(DODOES)
  })

  test('does>-defined word runs the DOES> code with the PFA on the stack', () => {
    const f = new Forth()
    // : array create cells allot does> swap cells + ;  index into a cell array
    f.interpret(': array create cells allot does> swap cells + ;')
    f.interpret('5 array v')
    // v ( i -- addr ) : addr = PFA + i*CELL. Compare 3 v against 0 v.
    const base = f.interpret('0 v').stack[0]!
    expect(f.interpret('drop 3 v').stack).toEqual([base + 3 * CELL])
  })

  test('a does>-defined array stores and loads', () => {
    const f = new Forth()
    f.interpret(': array create cells allot does> swap cells + ;')
    f.interpret('4 array a')
    // a 2 ! ... a 2 @  (store 99 at index 2, read it back)
    const r = f.interpret('99 2 a ! 2 a @')
    expect(r.stack).toEqual([99])
  })

  test('two children of the same defining word are independent', () => {
    const f = new Forth()
    f.interpret(': const create , does> @ ;')
    f.interpret('1 const one 2 const two')
    expect(f.interpret('one two').stack).toEqual([1, 2])
  })
})

describe('>BODY (§V.24 CREATE-class only)', () => {
  test('>body returns the PFA of a create word (CFA + 2*CELL)', () => {
    const f = new Forth()
    f.interpret('create x')
    const xt = f.dict.find('x')!.xt
    expect(f.interpret("' x >body").stack).toEqual([xt + 2 * CELL])
  })

  test('>body agrees with what the create word pushes', () => {
    const f = new Forth()
    f.interpret('create x')
    const viaWord = f.interpret('x').stack[0]
    const viaBody = f.interpret("drop ' x >body").stack[0]
    expect(viaBody).toBe(viaWord)
  })

  test('>body on a does>-class word works too (DODOES)', () => {
    const f = new Forth()
    f.interpret(': const create , does> @ ;')
    f.interpret('7 const c')
    const xt = f.dict.find('c')!.xt
    expect(f.interpret("' c >body").stack).toEqual([xt + 2 * CELL])
  })

  test('>body on a colon word -> THROW -9 (not CREATE-class)', () => {
    const f = new Forth()
    f.interpret(': foo 1 ;')
    expect(f.interpret("' foo >body").throwCode).toBe(-9)
  })

  test('>body on a constant -> THROW -9 (1-slot DOCONST, not CREATE-class)', () => {
    const f = new Forth()
    f.interpret('5 constant fivve')
    expect(f.interpret("' fivve >body").throwCode).toBe(-9)
  })
})
