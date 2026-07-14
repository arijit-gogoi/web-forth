// CATCH / THROW (SPEC §T.21, §V.17). catch ( xt -- code ) runs xt through a nested
// execute()->run() (a §V.1 carve-out) and returns 0 on clean exit or the THROW code
// on a throw, having restored the shared registers so the ENCLOSING trampoline
// survives. The load-bearing proof is that execution CONTINUES in the caller after
// catch returns (the `running` restore): a catch that swallowed `running` would let
// the caller's body die silently right after catch.

import { describe, expect, test } from 'vitest'
import { Forth } from './forth'

describe('catch clean exit (§V.17)', () => {
  test('catch of a word that does not throw returns 0', () => {
    const f = new Forth()
    f.interpret(': noop ;')
    expect(f.interpret("' noop catch").stack).toEqual([0])
  })

  test('execution CONTINUES in the caller after a clean catch (running restored)', () => {
    const f = new Forth()
    // : t ['] noop catch . 99 . ;  If `running` were not restored, the trampoline
    // would stop the instant catch returns and "99 ." would never run.
    f.interpret(': noop ;')
    const r = f.interpret(": t ['] noop catch . 99 . ; t")
    expect(r.output).toBe('0 99 ')
  })

  test('a clean catch leaves the caught word’s stack results in place', () => {
    const f = new Forth()
    // : pushes 7 8 ;  ['] pushes catch  -> 7 8 then 0 (the catch code) on top
    f.interpret(': pushes 7 8 ;')
    expect(f.interpret("' pushes catch").stack).toEqual([7, 8, 0])
  })
})

describe('catch of a throw (§V.17)', () => {
  test('catch returns the THROW code its xt raised', () => {
    const f = new Forth()
    f.interpret(': boom -5 throw ;')
    expect(f.interpret("' boom catch").stack).toEqual([-5])
  })

  test('execution continues in the caller after catching a throw', () => {
    const f = new Forth()
    f.interpret(': boom -5 throw ;')
    // catch absorbs the throw, . prints -5, then 99 . must still run
    const r = f.interpret(": t ['] boom catch . 99 . ; t")
    expect(r.output).toBe('-5 99 ')
  })

  test('catch restores the stack depth to before the xt ran (junk dropped)', () => {
    const f = new Forth()
    // messy pushes 1 2 3 then throws; catch must restore dsp to before ['] messy ran,
    // so only the code -9 remains (the 1 2 3 are discarded).
    f.interpret(': messy 1 2 3 -9 throw ;')
    expect(f.interpret("' messy catch").stack).toEqual([-9])
  })

  test('catch ABSORBS the throw at top level (no abort, throwCode null)', () => {
    const f = new Forth()
    f.interpret(': boom -13 throw ;')
    // : safe ['] boom catch ;  safe .  -> prints -13, and the RunResult is clean:
    // no "Error"/abort text, throwCode null. That is the whole point of catch.
    const r = f.interpret(": safe ['] boom catch ; safe .")
    expect(r.output).toBe('-13 ')
    expect(r.throwCode).toBeNull()
    expect(r.stack).toEqual([])
  })
})

describe('throw 0 is a no-op (§V.17, ANS)', () => {
  test('catch of a word that throws 0 returns 0 and does not unwind', () => {
    const f = new Forth()
    // : zero 0 throw ;  throw 0 must NOT unwind; the word completes cleanly, catch -> 0
    f.interpret(': zero 5 0 throw ;')
    // stack after: 5 (survives, no unwind) then 0 (catch code)
    expect(f.interpret("' zero catch").stack).toEqual([5, 0])
  })
})

describe('nested catch -> nearest (§V.17)', () => {
  test('the inner catch handles the throw; the outer catch sees a clean exit', () => {
    const f = new Forth()
    f.interpret(': boom -7 throw ;')
    f.interpret(": inner ['] boom catch ;") // inner catches -7, exits clean, leaves -7
    // : outer ['] inner catch ;  inner exits cleanly (it absorbed boom), so outer's
    // catch yields 0. Stack: -7 (from inner) then 0 (outer's catch code).
    const r = f.interpret(": outer ['] inner catch ; outer")
    expect(r.stack).toEqual([-7, 0])
  })
})
