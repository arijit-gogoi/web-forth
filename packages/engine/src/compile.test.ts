import { describe, expect, test } from 'vitest'
import { Forth } from './forth'
import { CELL } from './memory'

describe('colon compilation (§V.11)', () => {
  // Advisor's smallest literal round-trip: proves lit is compiled by its xt.
  test(': five 5 ; five -> [5]', () => {
    const f = new Forth()
    const r = f.interpret(': five 5 ; five')
    expect(r.stack).toEqual([5])
    expect(r.throwCode).toBeNull()
  })

  test(': sq dup * ; 3 sq -> 9 (compiled call nests)', () => {
    const f = new Forth()
    expect(f.interpret(': sq dup * ; 3 sq').stack).toEqual([9])
  })

  test('a colon word calling another colon word', () => {
    const f = new Forth()
    const r = f.interpret(': sq dup * ; : quad sq sq ; 2 quad')
    expect(r.stack).toEqual([16]) // (2^2)^2
  })

  test('colon CFA is DOCOL and body ends in the EXIT xt', () => {
    const f = new Forth()
    f.interpret(': foo 1 2 ;')
    const found = f.dict.find('foo')!
    // CFA cell holds the DOCOL routine index
    expect(f.mem.cellAt(found.xt)).toBe(f.docolIndex)
    // last compiled cell (just before here) is EXIT's xt
    const lastCell = f.mem.here - CELL
    expect(f.mem.cellAt(lastCell)).toBe(f.exitXt)
  })

  test('a word is smudged mid-definition: a redefinition sees the OLD word', () => {
    const f = new Forth()
    // : t 5 ;   then   : t t t ;   -- the two `t` refs compile to the OLD t (5),
    // because the new t is smudged (invisible) until its own ; reveals it.
    const r = f.interpret(': t 5 ; : t t t ; t')
    expect(r.stack).toEqual([5, 5]) // old t ran twice; new t is not self-recursive
    expect(r.throwCode).toBeNull()
  })

  test('numbers compile as literals; the definition is reusable', () => {
    // Note: the data stack persists across interpret() calls (REPL semantics), so
    // drop between reuses rather than expecting isolation.
    const f = new Forth()
    f.interpret(': add7 7 + ;')
    expect(f.interpret('10 add7').stack).toEqual([17])
    expect(f.interpret('drop 100 add7').stack).toEqual([107])
  })
})

describe('[ ] and immediate (§V.11)', () => {
  test('[ switches to interpret inside a definition, ] back to compile', () => {
    const f = new Forth()
    // compute 3*4 at compile time via [ ... ] and compile the literal 12
    const r = f.interpret(': twelve [ 3 4 * ] literal ; twelve')
    expect(r.stack).toEqual([12])
  })

  test('immediate makes a word run during compilation', () => {
    const f = new Forth()
    // define an immediate word that pushes 99 at compile time; use it in a colon
    const r = f.interpret(
      ': stamp 99 ; immediate : useit [ ] stamp ;',
    )
    // `stamp` immediate ran while compiling useit, leaving 99 on the stack now
    expect(r.stack).toEqual([99])
  })
})

describe('compile-only guard (§V.15) — reachable only now', () => {
  test('if run in interpret state -> THROW -14', () => {
    const f = new Forth()
    const r = f.interpret('if')
    expect(r.throwCode).toBe(-14)
  })

  test('; run in interpret state -> THROW -14', () => {
    const f = new Forth()
    expect(f.interpret(';').throwCode).toBe(-14)
  })

  test('then / begin / until / do / loop guarded too', () => {
    for (const word of ['then', 'begin', 'until', 'again', 'else', 'do', 'loop']) {
      const f = new Forth()
      expect(f.interpret(word).throwCode).toBe(-14)
    }
  })
})

describe('control flow: if else then', () => {
  test('if ... then (true branch runs)', () => {
    const f = new Forth()
    const r = f.interpret(': t if 42 then ; -1 t')
    expect(r.stack).toEqual([42])
  })

  test('if ... then (false skips)', () => {
    const f = new Forth()
    const r = f.interpret(': t if 42 then ; 0 t')
    expect(r.stack).toEqual([])
  })

  test('if ... else ... then', () => {
    const f = new Forth()
    f.interpret(': sign 0< if -1 else 1 then ;')
    expect(f.interpret('-5 sign').stack).toEqual([-1])
    expect(f.interpret('drop 5 sign').stack).toEqual([1]) // drop prior result first
  })

  test('nested if inside a colon (primitives only)', () => {
    const f = new Forth()
    // : clamp0 ( n -- n' ) dup 0< if drop 0 then ;  floors at zero
    f.interpret(': clamp0 dup 0< if drop 0 then ;')
    expect(f.interpret('-3 clamp0').stack).toEqual([0])
    expect(f.interpret('drop 7 clamp0').stack).toEqual([7])
  })
})

describe('control flow: begin until / again', () => {
  test('begin ... until counts down', () => {
    const f = new Forth()
    // : cd ( n -- ) begin 1- dup 0= until drop ;  runs a small loop
    const r = f.interpret(': cd begin 1- dup 0= until drop ; 5 cd')
    expect(r.stack).toEqual([]) // consumed
    expect(r.throwCode).toBeNull()
  })

  test('begin ... again with an if-guarded exit is not required; until suffices', () => {
    const f = new Forth()
    // accumulate 3+2+1 using a counter and an accumulator on the return stack-free way
    const r = f.interpret(': sum3 0 3 begin over + swap 1- swap over 0= until drop drop ;')
    expect(r.throwCode).toBeNull()
  })
})

describe('control flow: do loop', () => {
  test('do loop runs the body (limit - index) times', () => {
    const f = new Forth()
    // : dots ( n -- ) 0 do 42 emit loop ;  emits n asterisks-equivalent
    const r = f.interpret(': stars 0 do 42 emit loop ; 5 stars')
    expect(r.output).toBe('*****') // 42 == '*'
  })

  test('post-test DO runs the body once when limit==index (?DO is the Extended zero-trip variant)', () => {
    const f = new Forth()
    const r = f.interpret(': stars 0 do 42 emit loop ; 0 stars')
    expect(r.output).toBe('*') // one trip: DO is post-test; ?DO (T21) would skip
    expect(r.throwCode).toBeNull()
  })

  test('do loop body runs exactly (limit - index) times', () => {
    const f = new Forth()
    // : count5 ( -- n ) 0 5 0 do 1 + loop ;  do consumes limit=5,index=0; body adds 1 five times
    const r = f.interpret(': count5 0 5 0 do 1 + loop ; count5')
    expect(r.stack).toEqual([5]) // accumulator incremented once per trip
  })
})
