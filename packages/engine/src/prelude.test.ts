import { describe, expect, test } from 'vitest'
import { Forth } from './forth'

describe('comments', () => {
  test('( ... ) is ignored inline', () => {
    const f = new Forth()
    expect(f.interpret('1 ( this is a comment ) 2 +').stack).toEqual([3])
  })

  test('( ) works inside a definition', () => {
    const f = new Forth()
    const r = f.interpret(': add ( a b -- a+b ) + ; 4 5 add')
    expect(r.stack).toEqual([9])
  })

  test('backslash skips to end of line', () => {
    const f = new Forth()
    const r = f.interpret('1 2 + \\ trailing comment ignored\n3 *')
    expect(r.stack).toEqual([9]) // (1+2)*3
  })
})

describe('variable / constant (CREATE-class, §V.11)', () => {
  test('variable stores and fetches via its PFA', () => {
    const f = new Forth()
    const r = f.interpret('variable x  42 x !  x @')
    expect(r.stack).toEqual([42])
  })

  test('variable body starts at zero', () => {
    const f = new Forth()
    expect(f.interpret('variable y  y @').stack).toEqual([0])
  })

  test('+! accumulates into a variable', () => {
    const f = new Forth()
    const r = f.interpret('variable c  0 c !  5 c +!  3 c +!  c @')
    expect(r.stack).toEqual([8])
  })

  test('constant pushes its value', () => {
    const f = new Forth()
    const r = f.interpret('7 constant seven  seven seven +')
    expect(r.stack).toEqual([14])
  })
})

describe('prelude words (§V.16)', () => {
  test('a fresh Forth boots with the prelude loaded and no leftover output', () => {
    const f = new Forth()
    expect(f.output).toBe('') // prelude output discarded
    // prelude words are present
    for (const w of ['?dup', 'nip', 'tuck', '2dup', '2drop', 'abs', 'min', 'max', 'spaces']) {
      expect(f.dict.find(w)).not.toBeNull()
    }
  })

  test('?dup duplicates only non-zero', () => {
    const f = new Forth()
    expect(f.interpret('5 ?dup').stack).toEqual([5, 5])
    const g = new Forth()
    expect(g.interpret('0 ?dup').stack).toEqual([0])
  })

  test('nip tuck', () => {
    const f = new Forth()
    expect(f.interpret('1 2 nip').stack).toEqual([2])
    const g = new Forth()
    expect(g.interpret('1 2 tuck').stack).toEqual([2, 1, 2])
  })

  test('2dup 2drop', () => {
    const f = new Forth()
    expect(f.interpret('1 2 2dup').stack).toEqual([1, 2, 1, 2])
    const g = new Forth()
    expect(g.interpret('1 2 3 4 2drop').stack).toEqual([1, 2])
  })

  test('abs min max', () => {
    const f = new Forth()
    expect(f.interpret('-9 abs').stack).toEqual([9])
    const g = new Forth()
    expect(g.interpret('3 8 min').stack).toEqual([3])
    const h = new Forth()
    expect(h.interpret('3 8 max').stack).toEqual([8])
  })

  test('true false 0<>', () => {
    const f = new Forth()
    expect(f.interpret('true').stack).toEqual([-1])
    const g = new Forth()
    expect(g.interpret('false').stack).toEqual([0])
    const h = new Forth()
    expect(h.interpret('5 0<>').stack).toEqual([-1])
    const k = new Forth()
    expect(k.interpret('0 0<>').stack).toEqual([0])
  })

  test('spaces emits n spaces and is zero-safe', () => {
    const f = new Forth()
    expect(f.interpret('3 spaces').output).toBe('   ')
    const g = new Forth()
    expect(g.interpret('0 spaces').output).toBe('') // guarded: DO would run once
    const h = new Forth()
    expect(h.interpret('-2 spaces').output).toBe('') // negative safe
  })

  // §V.16: prelude loads clean; reset re-loads it clean.
  test('reset re-boots with the prelude intact', () => {
    const f = new Forth()
    f.interpret('variable junk 999 junk !')
    f.reset()
    expect(f.dict.find('?dup')).not.toBeNull() // prelude reloaded
    expect(f.interpret('4 abs').stack).toEqual([4]) // still works
  })
})
