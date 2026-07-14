// Control-flow completion (SPEC §T.22, §V.15, §V.22): +loop ?do i j while repeat.
// The discriminating cases are the negative-step +loop (which plain (loop)'s
// index<limit cannot terminate) and the zero-trip ?do (which post-test do cannot
// skip). i/j read the loop indices off the return stack; while/repeat close the
// begin-family test-in-the-middle loop.

import { describe, expect, test } from 'vitest'
import { Forth } from './forth'

describe('compile-only guard (§V.15) — new immediates', () => {
  test('?do +loop while repeat each THROW -14 in interpret state', () => {
    for (const word of ['?do', '+loop', 'while', 'repeat']) {
      const f = new Forth()
      expect(f.interpret(word).throwCode).toBe(-14)
    }
  })
})

describe('loop index words i / j (§V.22)', () => {
  test('i yields the innermost index each trip', () => {
    const f = new Forth()
    const r = f.interpret(': t 3 0 do i . loop ; t')
    expect(r.output).toBe('0 1 2 ')
  })

  test('j yields the outer index in a nested loop', () => {
    const f = new Forth()
    // outer 0..1, inner 0..1; print j then i each inner trip
    const r = f.interpret(': t 2 0 do 2 0 do j i loop loop ; t')
    // outer j=0: (0,0)(0,1); outer j=1: (1,0)(1,1)
    expect(r.stack).toEqual([0, 0, 0, 1, 1, 0, 1, 1])
  })
})

describe('+loop (§V.22 boundary-crossing termination)', () => {
  test('positive step counts up', () => {
    const f = new Forth()
    const r = f.interpret(': t 10 0 do i . 2 +loop ; t')
    expect(r.output).toBe('0 2 4 6 8 ')
  })

  test('negative step counts DOWN (index<limit cannot do this)', () => {
    const f = new Forth()
    // 0 5 do ... -1 +loop : index starts 5, limit 0, steps down, stops after 0
    const r = f.interpret(': t 0 5 do i . -1 +loop ; t')
    expect(r.output).toBe('5 4 3 2 1 0 ')
  })

  test('a step larger than the range still terminates (single trip)', () => {
    const f = new Forth()
    const r = f.interpret(': t 10 0 do i . 100 +loop ; t')
    expect(r.output).toBe('0 ') // one trip, then 0+100 crosses 10
    expect(r.throwCode).toBeNull()
  })
})

describe('?do (§V.22 zero-trip skip)', () => {
  test('?do with limit==index skips the body entirely', () => {
    const f = new Forth()
    const r = f.interpret(': t ?do 42 emit loop ; 0 0 t')
    expect(r.output).toBe('') // empty: ?do skips when limit==index
    expect(r.throwCode).toBeNull()
  })

  test('plain do with limit==index runs once (contrast: post-test)', () => {
    const f = new Forth()
    const r = f.interpret(': t do 42 emit loop ; 0 0 t')
    expect(r.output).toBe('*') // one trip, proving ?do is the difference
  })

  test('?do with a non-empty range runs normally', () => {
    const f = new Forth()
    const r = f.interpret(': stars ?do 42 emit loop ; 3 0 stars')
    expect(r.output).toBe('***')
  })

  test('?do supports i inside the body', () => {
    const f = new Forth()
    const r = f.interpret(': t ?do i . loop ; 4 1 t')
    expect(r.output).toBe('1 2 3 ')
  })
})

describe('begin ... while ... repeat (§V.15 test-in-the-middle)', () => {
  test('while gates the loop, repeat jumps back', () => {
    const f = new Forth()
    const r = f.interpret(': t begin dup 0> while dup . 1- repeat drop ; 3 t')
    expect(r.output).toBe('3 2 1 ')
    expect(r.stack).toEqual([])
  })

  test('while with a false flag on entry runs zero times', () => {
    const f = new Forth()
    const r = f.interpret(': t begin dup 0> while dup . 1- repeat drop ; 0 t')
    expect(r.output).toBe('')
    expect(r.throwCode).toBeNull()
  })

  test('a counted accumulator via while/repeat', () => {
    const f = new Forth()
    // sum 1..n : 0 (acc) n  begin dup 0> while  tuck + swap 1-  repeat drop
    const r = f.interpret(': sum 0 swap begin dup 0> while tuck + swap 1- repeat drop ; 5 sum')
    expect(r.stack).toEqual([15]) // 5+4+3+2+1
  })
})

describe('?do combined with +loop (both Extended constructs together)', () => {
  test('?do ... +loop with a positive step', () => {
    const f = new Forth()
    const r = f.interpret(': t ?do i . 2 +loop ; 8 0 t')
    expect(r.output).toBe('0 2 4 6 ')
  })

  test('?do ... +loop skips when limit==index', () => {
    const f = new Forth()
    const r = f.interpret(': t ?do i . 1 +loop ; 5 5 t')
    expect(r.output).toBe('') // zero-trip: ?do skip fires even with +loop closer
    expect(r.throwCode).toBeNull()
  })
})

describe('regression: plain do/loop still works after the skipSlot change', () => {
  test('0 do .. loop counts (limit-index) times', () => {
    const f = new Forth()
    expect(f.interpret(': stars 0 do 42 emit loop ; 5 stars').output).toBe('*****')
  })
})
