// recurse (SPEC §T.27, §V.25, §V.15). recurse compiles a call to the definition in
// progress. The discriminating case is genuine self-reference: because `:` smudges
// LATEST until `;` (§V.11), a word cannot call itself by name (compile.test.ts proves
// the by-name attempt binds the OLD word). recurse reaches the smudged word by its CFA
// so classic recursive definitions (factorial, Fibonacci) compile and run.

import { describe, expect, test } from 'vitest'
import { Forth } from './forth'

describe('recurse self-reference (§V.25)', () => {
  test('factorial via recurse', () => {
    const f = new Forth()
    // : fac ( n -- n! ) dup 1 > if dup 1- recurse * then ;
    f.interpret(': fac dup 1 > if dup 1- recurse * then ;')
    expect(f.interpret('5 fac').stack).toEqual([120]) // 5!
    expect(f.interpret('drop 6 fac').stack).toEqual([720]) // 6!
  })

  test('recurse binds the in-progress word, NOT a prior same-named word', () => {
    const f = new Forth()
    // Contrast with compile.test.ts ": t 5 ; : t t t ;" where by-name binds the OLD t.
    // Here the OLD t returns 99; the NEW t recurses (countdown to 0), proving recurse
    // targets the smudged LATEST, not the visible older definition.
    f.interpret(': t 99 ;')
    // : t ( n -- ) dup 0> if dup . 1- recurse else drop then ;  -- counts n..1
    // Each level prints, decrements, and recurses; the base case (0) drops it. The
    // value is threaded through 1- into the recursive call, so no level double-drops.
    const r = f.interpret(': t dup 0> if dup . 1- recurse else drop then ; 3 t')
    expect(r.output).toBe('3 2 1 ') // recursion, not the old t (which would push 99)
    expect(r.stack).toEqual([])
  })

  test('mutual base case: recurse terminates and unwinds cleanly (rstack balanced)', () => {
    const f = new Forth()
    // sum 1..n by recursion: : sum dup 0> if dup 1- recurse + else drop 0 then ;
    f.interpret(': sum dup 0> if dup 1- recurse + else drop 0 then ;')
    expect(f.interpret('5 sum').stack).toEqual([15]) // 5+4+3+2+1
    // a second call proves no return-stack junk survived the first recursion
    expect(f.interpret('drop 4 sum').stack).toEqual([10]) // 4+3+2+1
  })
})

describe('recurse compile-only guard (§V.15)', () => {
  test('recurse in interpret state -> THROW -14', () => {
    const f = new Forth()
    expect(f.interpret('recurse').throwCode).toBe(-14)
  })
})

describe('recurse compiles latest CFA (§V.25 mechanism)', () => {
  test('the compiled recurse cell is the word own CFA', () => {
    const f = new Forth()
    // : self recurse ;  -- the body holds exactly [ self-CFA ][ EXIT ]. After `;`
    // reveals it, find(self).xt is that CFA, and the first body cell must equal it.
    f.interpret(': self recurse ;')
    const xt = f.dict.find('self')!.xt
    // body starts one cell after the CFA (DOCOL header); first cell = the recurse target
    const firstBodyCell = f.mem.cellAt(xt + 4) // CELL = 4
    expect(firstBodyCell).toBe(xt)
  })
})
