// Standard word-set: stack / bit / arith / mem (SPEC §T.29, §V.29). The plain words
// (depth 2swap 2over -rot 2* lshift */mod u> move fill) get a straightforward check;
// the discriminating cases are the §V.29 precision/sign contracts that a naive
// implementation gets wrong: */ must use a wide intermediate (not `* /`), rshift is
// logical while 2/ is arithmetic, and u</u> are unsigned.

import { describe, expect, test } from 'vitest'
import { Forth } from './forth'

const stack = (src: string): ReadonlyArray<number> => new Forth().interpret(src).stack

describe('stack words (§V.29)', () => {
  test('depth reports the data-stack depth', () => {
    expect(stack('depth')).toEqual([0])
    expect(stack('10 20 30 depth')).toEqual([10, 20, 30, 3])
  })

  test('2swap swaps the top two pairs', () => {
    expect(stack('1 2 3 4 2swap')).toEqual([3, 4, 1, 2])
  })

  test('2over copies the second pair over the first', () => {
    expect(stack('1 2 3 4 2over')).toEqual([1, 2, 3, 4, 1, 2])
  })

  test('-rot rotates the other way (prelude)', () => {
    expect(stack('1 2 3 -rot')).toEqual([3, 1, 2]) // rot gives [2,3,1]; -rot the inverse
  })
})

describe('bit / shift words (§V.29 logical vs arithmetic)', () => {
  test('2* doubles', () => {
    expect(stack('5 2*')).toEqual([10])
    expect(stack('-3 2*')).toEqual([-6])
  })

  test('2/ is arithmetic (sign-preserving)', () => {
    expect(stack('8 2/')).toEqual([4])
    expect(stack('-4 2/')).toEqual([-2]) // NOT a huge unsigned value
  })

  test('lshift shifts left by u bits', () => {
    expect(stack('1 4 lshift')).toEqual([16]) // 1<<4
  })

  test('rshift is LOGICAL (zero-fill), distinct from 2/', () => {
    // -1 is 0xffffffff; a logical >>>1 fills zero -> 0x7fffffff. An arithmetic shift
    // would give -1. This is the case that proves rshift != 2/ family.
    expect(stack('-1 1 rshift')).toEqual([0x7fffffff])
    expect(stack('16 2 rshift')).toEqual([4])
  })
})

describe('*/ and */mod use a WIDE intermediate (§V.29)', () => {
  test('*/ does not truncate the a*b product (the core §V.29 case)', () => {
    // 100000 * 100000 = 10_000_000_000, far past 2^31. A naive `* /` truncates the
    // product to 32 bits (Math.imul wraps) and gets the wrong answer; the wide path
    // divides the full product: 100000*100000/100000 == 100000.
    expect(stack('100000 100000 100000 */')).toEqual([100000])
  })

  test('*/ scales correctly with rounding toward zero', () => {
    // 7 * 3 / 2 = 21/2 = 10 (truncated)
    expect(stack('7 3 2 */')).toEqual([10])
  })

  test('*/mod leaves remainder then quotient, both from the wide product', () => {
    // 7 * 3 = 21; 21 /mod 2 -> rem 1, quot 10
    expect(stack('7 3 2 */mod')).toEqual([1, 10])
  })

  test('*/ by zero throws -10', () => {
    expect(new Forth().interpret('5 6 0 */').throwCode).toBe(-10)
  })

  test('*/mod by zero throws -10', () => {
    expect(new Forth().interpret('5 6 0 */mod').throwCode).toBe(-10)
  })
})

describe('unsigned comparison u< u> (§V.29)', () => {
  test('u< treats cells as unsigned', () => {
    // -1 is 0xffffffff, the LARGEST unsigned, so -1 is NOT < 1 unsigned.
    expect(stack('-1 1 u<')).toEqual([0]) // false
    expect(stack('1 -1 u<')).toEqual([-1]) // true: 1 < 0xffffffff
    expect(stack('3 5 u<')).toEqual([-1]) // ordinary case still works
  })

  test('u> is the unsigned mirror', () => {
    expect(stack('-1 1 u>')).toEqual([-1]) // true: 0xffffffff > 1
    expect(stack('1 -1 u>')).toEqual([0]) // false
  })
})

describe('memory block words move / fill', () => {
  test('fill sets a run of bytes', () => {
    const f = new Forth()
    // fill 4 bytes at HERE with 'A' (65), then read them back with type
    const r = f.interpret('here 4 65 fill  here 4 type')
    expect(r.output).toBe('AAAA')
  })

  test('move copies bytes (non-overlapping)', () => {
    const f = new Forth()
    // write "Hi" at here, move it 8 bytes along, type the destination
    const r = f.interpret(
      'here 72 over c! 1+ 105 over c! drop  here dup 8 + 2 move  here 8 + 2 type',
    )
    expect(r.output).toBe('Hi')
  })

  test('move is overlap-correct (forward overlap, like memmove)', () => {
    const f = new Forth()
    // ABCD at here; move [here..+3] to here+1 (overlapping). memmove semantics keep
    // the source intact during the copy, giving AABCD (dst[0] unchanged, then ABCD).
    f.interpret('here 65 over c! 1+ 66 over c! 1+ 67 over c! 1+ 68 over c! drop')
    const r = f.interpret('here dup 1+ 4 move  here 5 type')
    expect(r.output).toBe('AABCD')
  })
})
