// Engine capstone (SPEC §T.11, §I.lib). Golden cases lifted from the easyforth
// tutorial (https://skilldrick.github.io/easyforth/) plus §I.lib surface + §V.4
// snapshot-copy checks. These are the end-to-end acceptance criteria that the
// engine authentically runs Forth, not the per-unit tests of earlier tasks.

import { describe, expect, test } from 'vitest'
import { ForthFault } from './errors'
import { Forth } from './forth'
import type { RunResult, WordInfo } from './forth'

// Run a single line on a fresh VM.
const line = (src: string): RunResult => new Forth().interpret(src)

describe('easyforth golden cases: stack + arithmetic', () => {
  test('pushing numbers builds the stack', () => {
    expect(line('1 2 3').stack).toEqual([1, 2, 3])
  })

  test('. pops and prints the top', () => {
    const r = line('1 2 3 . . .')
    expect(r.output).toBe('3 2 1 ') // printed top-first
    expect(r.stack).toEqual([])
  })

  test('addition: 10 20 + .', () => {
    expect(line('10 20 + .').output).toBe('30 ')
  })

  test('the classic 3 4 + is 7', () => {
    expect(line('3 4 +').stack).toEqual([7])
  })

  test('order of operations is RPN', () => {
    // (6 + 3) * (4 - 2) = 18
    expect(line('6 3 + 4 2 - *').stack).toEqual([18])
  })

  test('.s shows the stack non-destructively', () => {
    const r = line('1 2 3 .s')
    expect(r.output).toBe('<3> 1 2 3 ')
    expect(r.stack).toEqual([1, 2, 3])
  })
})

describe('easyforth golden cases: stack manipulation', () => {
  test('dup swap over rot drop', () => {
    expect(line('1 2 dup').stack).toEqual([1, 2, 2])
    expect(line('1 2 swap').stack).toEqual([2, 1])
    expect(line('1 2 over').stack).toEqual([1, 2, 1])
    expect(line('1 2 3 rot').stack).toEqual([2, 3, 1])
    expect(line('1 2 drop').stack).toEqual([1])
  })
})

describe('easyforth golden cases: defining words', () => {
  test(': square dup * ;  3 square', () => {
    const f = new Forth()
    f.interpret(': square dup * ;')
    expect(f.interpret('3 square').stack).toEqual([9])
  })

  test('define and use across the same buffer', () => {
    expect(line(': square dup * ; 5 square .').output).toBe('25 ')
  })

  test('words compose: : quad square square ;', () => {
    const f = new Forth()
    f.interpret(': square dup * ; : quad square square ;')
    expect(f.interpret('3 quad').stack).toEqual([81]) // (3^2)^2
  })

  test('constants and variables (easyforth memory section)', () => {
    const f = new Forth()
    f.interpret('42 constant answer')
    expect(f.interpret('answer').stack).toEqual([42])
    const g = new Forth()
    expect(g.interpret('variable balance 123 balance ! balance @').stack).toEqual([123])
  })
})

describe('easyforth golden cases: conditionals', () => {
  test(': test if ." yes" then ; style branch (via numbers)', () => {
    const f = new Forth()
    f.interpret(': pos? 0> if 1 else 0 then ;')
    expect(f.interpret('5 pos?').stack).toEqual([1])
    expect(f.interpret('drop -5 pos?').stack).toEqual([0])
  })

  test('absolute value via if', () => {
    const f = new Forth()
    f.interpret(': myabs dup 0< if negate then ;')
    expect(f.interpret('-7 myabs').stack).toEqual([7])
    expect(f.interpret('drop 7 myabs').stack).toEqual([7])
  })
})

describe('easyforth golden cases: loops', () => {
  test('do loop emits a row of stars', () => {
    const f = new Forth()
    f.interpret(': stars 0 do 42 emit loop ;')
    expect(f.interpret('5 stars').output).toBe('*****')
  })

  test('begin until countdown', () => {
    const f = new Forth()
    // : countdown ( n -- ) begin dup . 1- dup 0= until drop ;
    const r = f.interpret(': countdown begin dup . 1- dup 0= until drop ; 5 countdown')
    expect(r.output).toBe('5 4 3 2 1 ')
    expect(r.stack).toEqual([])
  })
})

describe('easyforth golden cases: number bases', () => {
  test('hex input and output', () => {
    expect(line('hex ff .').output).toBe('ff ')
    expect(line('hex 10 .').output).toBe('10 ') // 16 decimal printed as hex 10
  })

  test('$ hex literal in decimal mode', () => {
    expect(line('$ff .').output).toBe('255 ')
  })

  test('decimal restores base', () => {
    expect(line('hex a decimal .').output).toBe('10 ')
  })
})

describe('§I.lib surface', () => {
  test('RunResult has output, throwCode, stack', () => {
    const r = line('1 2 +')
    expect(r).toEqual({ output: '', throwCode: null, stack: [3] })
  })

  test('errors ride the success channel (throwCode non-null, still a RunResult)', () => {
    const r = line('nonexistent-word')
    expect(r.throwCode).toBe(-13)
    expect(typeof r.output).toBe('string')
    expect(Array.isArray(r.stack)).toBe(true)
  })

  test('dictSnapshot returns WordInfo entries newest-first', () => {
    const f = new Forth()
    f.interpret(': myword 1 ;')
    const snap: ReadonlyArray<WordInfo> = f.dictSnapshot()
    expect(snap[0]?.name).toBe('myword') // newest first
    expect(snap.some((w) => w.name === 'dup')).toBe(true)
  })

  test('reset clears user state but restores primitives + prelude', () => {
    const f = new Forth()
    f.interpret(': foo 1 ; 1 2 3')
    expect(f.dict.find('foo')).not.toBeNull()
    f.reset()
    expect(f.dict.find('foo')).toBeNull() // user word gone
    expect(f.dict.find('dup')).not.toBeNull() // primitive back
    expect(f.dict.find('abs')).not.toBeNull() // prelude back
    expect(f.interpret('2 2 +').stack).toEqual([4])
  })
})

describe('§V.4 snapshot is a detached copy', () => {
  test('mutating the live stack does not change a prior snapshot', () => {
    const f = new Forth()
    f.interpret('10 20 30')
    const snap = f.stackSnapshot()
    expect(snap).toEqual([10, 20, 30])
    f.interpret('drop drop') // mutate live stack
    expect(snap).toEqual([10, 20, 30]) // snapshot unchanged
    expect(f.stackSnapshot()).toEqual([10]) // fresh snapshot reflects the change
  })

  test('the RunResult.stack is also a copy, not the live buffer', () => {
    const f = new Forth()
    const r = f.interpret('1 2 3')
    f.interpret('drop')
    expect(r.stack).toEqual([1, 2, 3]) // the earlier result is frozen
  })
})

// The machine-checkable form of "§I is realized": every v1 word the interface
// promises must resolve in a fresh VM. This is the acceptance criterion for
// "engine complete" and guards against silent word-set drift.
describe('§I v1 word-set is fully installed', () => {
  const V1_WORDS = [
    // arith
    '+', '-', '*', '/', 'mod', '=', '<>', '<', '>', '0=', '0<', '0>', 'and', 'or', 'xor', 'invert',
    // stack
    'dup', 'drop', 'swap', 'over', 'rot', '>r', 'r>',
    // mem
    '@', '!', 'c@', 'c!', '+!', ',', 'here', 'allot', 'cells', 'cell+', 'align', 'aligned',
    // io
    '.', '.s', 'u.', 'emit', 'cr', 'space', 'type',
    // compile
    ':', ';', '[', ']', 'immediate', 'literal', "'", "[']",
    // control (immediate)
    'if', 'else', 'then', 'begin', 'until', 'again', 'do', 'loop',
    // base
    'base', 'decimal', 'hex',
    // comments
    '(', '\\',
    // sys
    'bye', 'abort', 'throw',
    // prelude
    '?dup', 'nip', 'tuck', '2dup', '2drop', 'abs', 'min', 'max', 'negate', '1+', '1-',
    '0<>', 'true', 'false', 'variable', 'constant', 'spaces',
  ]

  test('every §I v1 word resolves in a fresh VM', () => {
    const f = new Forth()
    const missing = V1_WORDS.filter((w) => f.dict.find(w) === null)
    expect(missing).toEqual([])
  })
})

describe("§I words: type, base, ' , [']", () => {
  test('type prints bytes from memory', () => {
    const f = new Forth()
    // write "Hi" into the dictionary and type it
    const r = f.interpret('here 72 over c! 1+ 105 over c! drop  here 2 type')
    expect(r.output).toBe('Hi') // 72=H 105=i
  })

  test('base is a real cell: base @ reads it, base ! sets it', () => {
    const f = new Forth()
    expect(f.interpret('base @').stack).toEqual([10])
    const g = new Forth()
    // set base to 2 (binary), then 101 parses as 5
    expect(g.interpret('2 base ! 101 decimal .').output).toBe('5 ')
  })

  test("' pushes an xt that EXECUTE could run (here: it is a valid address)", () => {
    const f = new Forth()
    const r = f.interpret("' dup")
    expect(r.stack.length).toBe(1)
    expect(r.stack[0]).toBe(f.dict.find('dup')!.xt)
  })

  test("['] compiles a word's xt as a literal", () => {
    const f = new Forth()
    // : xt-of-dup ['] dup ;  returns dup's xt when run
    f.interpret(": xt-of-dup ['] dup ;")
    expect(f.interpret('xt-of-dup').stack).toEqual([f.dict.find('dup')!.xt])
  })
})

describe('VM faults vs Forth errors (§I.lib contract)', () => {
  test('a genuine ForthFault propagates; a Forth error does not', () => {
    const f = new Forth()
    const idx = f.inner.addRoutine(() => {
      throw new ForthFault('simulated corruption')
    })
    const cfa = f.dict.header('kaboom')
    f.mem.setCell(cfa, idx)
    expect(() => f.interpret('kaboom')).toThrow(ForthFault)
    // ordinary Forth errors never throw out
    expect(() => f.interpret('undefined-thing')).not.toThrow()
  })
})
