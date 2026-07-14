// leave (SPEC §T.28, §V.26, §V.22). leave exits the innermost do/?do loop early: a
// (leave) runtime UNLOOPs (drops the [limit,index] control pair off the return stack)
// then branches to just-past-the-loop. The discriminating cases are (a) the return
// stack is balanced after an early leave (a plain branch would leave it dirty), (b)
// leave in a nested loop exits only the innermost, and (c) several leaves in one loop
// all resolve to the same exit.

import { describe, expect, test } from 'vitest'
import { Forth } from './forth'

describe('leave basic exit (§V.26)', () => {
  test('leave stops the loop at the guard', () => {
    const f = new Forth()
    // print 0..9 but bail once i reaches 3
    const r = f.interpret(': t 10 0 do i . i 3 = if leave then loop ; t')
    expect(r.output).toBe('0 1 2 3 ') // prints 3 (the . runs before the guard), then leaves
    expect(r.throwCode).toBeNull()
  })

  test('the return stack is balanced after an early leave (UNLOOP, not a bare branch)', () => {
    const f = new Forth()
    // If (leave) branched WITHOUT dropping the loop control pair, rsp would be left
    // dirty and this second call would misbehave / underflow. A clean exit leaves the
    // data stack exactly as pushed and lets the word run again identically.
    f.interpret(': t 10 0 do i i 5 = if leave then loop ; ')
    const r1 = f.interpret('t')
    expect(r1.stack).toEqual([0, 1, 2, 3, 4, 5]) // pushed i each trip up to and incl. 5
    expect(r1.throwCode).toBeNull()
    const r2 = f.interpret('drop drop drop drop drop drop t') // clear, run again
    expect(r2.stack).toEqual([0, 1, 2, 3, 4, 5]) // identical: no return-stack junk survived
    expect(r2.throwCode).toBeNull()
  })

  test('leave that never fires: the loop runs to completion', () => {
    const f = new Forth()
    const r = f.interpret(': t 3 0 do i . i 99 = if leave then loop ; t')
    expect(r.output).toBe('0 1 2 ') // guard never true; full loop
  })
})

describe('leave in ?do (§V.26 + §V.22)', () => {
  test('leave exits a ?do loop early', () => {
    const f = new Forth()
    const r = f.interpret(': t ?do i . i 2 = if leave then loop ; 10 0 t')
    expect(r.output).toBe('0 1 2 ')
  })

  test('a zero-trip ?do with a leave in the body never executes the leave', () => {
    const f = new Forth()
    // limit==index so ?do skips the whole body; the leave inside is never reached and
    // the skip target (same address the leave resolves to) is used instead.
    const r = f.interpret(': t ?do i . leave loop ; 5 5 t')
    expect(r.output).toBe('')
    expect(r.throwCode).toBeNull()
  })
})

describe('leave in nested loops exits only the innermost (§V.26)', () => {
  test('inner leave does not break the outer loop', () => {
    const f = new Forth()
    // outer 0..2; inner 0..9 but leaves at inner i==1. So each outer trip prints
    // inner 0 1 then leaves; outer still runs all 3 times.
    const r = f.interpret(': t 3 0 do 10 0 do i . i 1 = if leave then loop 88 emit loop ; t')
    // per outer trip: "0 1 " then 'X' (88); three outer trips
    expect(r.output).toBe('0 1 X0 1 X0 1 X') // 88 == 'X'
    expect(r.throwCode).toBeNull()
  })

  test('the outer loop is intact after an inner leave (outer index still counts)', () => {
    const f = new Forth()
    // after the inner loop leaves, the outer control pair must remain (inner leave
    // dropped only the inner pair). Once the inner loop has closed, its index is the
    // top rstack cell, so `i` now reads the OUTER index; print it to prove the outer
    // loop still counts 0..1 and did not inherit the inner leave.
    const r = f.interpret(': t 2 0 do 5 0 do leave loop i . loop ; t')
    expect(r.output).toBe('0 1 ') // outer index printed each trip; inner left at once
    expect(r.throwCode).toBeNull()
  })
})

describe('multiple leaves in one loop (§V.26 leave-list)', () => {
  test('two leaves both resolve to the loop exit', () => {
    const f = new Forth()
    // two distinct leave sites; whichever fires jumps to the same past-loop point.
    const r = f.interpret(
      ': t 10 0 do i . i 2 = if leave then i 7 = if leave then loop 88 emit ; t',
    )
    expect(r.output).toBe('0 1 2 X') // first leave (i==2) fires; then the 88
    expect(r.throwCode).toBeNull()
  })
})

describe('leave with +loop (§V.26 + §V.22)', () => {
  test('leave exits a +loop', () => {
    const f = new Forth()
    const r = f.interpret(': t 20 0 do i . i 4 = if leave then 2 +loop ; t')
    expect(r.output).toBe('0 2 4 ') // steps 0,2,4; at 4 the guard leaves
  })
})

describe('leave compile-only guard (§V.15/§V.26)', () => {
  test('leave in interpret state -> THROW -14', () => {
    const f = new Forth()
    expect(f.interpret('leave').throwCode).toBe(-14)
  })

  test('leave inside a definition but outside a loop -> THROW -14', () => {
    const f = new Forth()
    // compile state, but no open do/?do: stray leave, nothing to leave.
    expect(f.interpret(': t leave ;').throwCode).toBe(-14)
  })
})
