// Strings + char literals (SPEC §T.23, §V.20, §V.23). Authentic Forth: s" and ."
// store their bytes INLINE in the definition thread; (s") / (.") read the inline
// count + bytes and advance ip past the cell-aligned payload (precedent: lit). The
// discriminating case is executable code AFTER the string in the same definition:
// it only runs if ip was realigned correctly (a type-only test would not prove it).
// char is an ordinary interpret-time word; s" ." [char] are compile-only (-14).

import { describe, expect, test } from 'vitest'
import { Forth } from './forth'

describe('char / [char] (§V.20)', () => {
  test('char pushes the first char code at interpret time (NOT compile-only)', () => {
    const f = new Forth()
    const r = f.interpret('char a')
    expect(r.stack).toEqual([97])
    expect(r.throwCode).toBeNull()
  })

  test('char takes only the first character of the word', () => {
    const f = new Forth()
    expect(f.interpret('char abc').stack).toEqual([97])
  })

  test('[char] compiles the char code as a literal', () => {
    const f = new Forth()
    f.interpret(': first-a [char] a ;')
    expect(f.interpret('first-a').stack).toEqual([97])
  })

  test('[char] outside a definition -> THROW -14 (compile-only)', () => {
    const f = new Forth()
    expect(f.interpret('[char] a').throwCode).toBe(-14)
  })
})

describe('s" inline counted string (§V.20)', () => {
  test('s" pushes ( c-addr u ) that type prints', () => {
    const f = new Forth()
    // : greet s" hi" type ;  -> prints "hi"
    const r = f.interpret(': greet s" hi" type ; greet')
    expect(r.output).toBe('hi')
    expect(r.throwCode).toBeNull()
  })

  test('s" length is exact (leading delimiter space is not content)', () => {
    const f = new Forth()
    // s" hi" must be length 2, not 3 (the space after s" is a delimiter)
    const r = f.interpret(': t s" hi" ;')
    expect(r.throwCode).toBeNull()
    // run it: stack is [c-addr, 2]
    expect(f.interpret('t nip').stack).toEqual([2])
  })

  test('code after the string still runs (proves ip realigned past the payload)', () => {
    const f = new Forth()
    // : g s" hi" type 42 . ;  -> "hi42 ".  If (s") left ip mid-payload, the 42 .
    // would misdispatch or throw -23. This is the discriminating alignment test.
    const r = f.interpret(': g s" hi" type 42 . ; g')
    expect(r.output).toBe('hi42 ')
    expect(r.throwCode).toBeNull()
  })

  test('a string whose length is a CELL multiple still aligns', () => {
    const f = new Forth()
    // "abcd" = 4 bytes; +1 count byte = 5, aligns to 8. Code after must still run.
    const r = f.interpret(': g s" abcd" type 1 . ; g')
    expect(r.output).toBe('abcd1 ')
    expect(r.throwCode).toBeNull()
  })

  test('an empty string is valid ( c-addr 0 )', () => {
    const f = new Forth()
    const r = f.interpret(': g s" " type 7 . ; g')
    expect(r.output).toBe('7 ')
    expect(r.throwCode).toBeNull()
  })

  test('s" outside a definition -> THROW -14 (compile-only, §V.23)', () => {
    const f = new Forth()
    expect(f.interpret('s" hi"').throwCode).toBe(-14)
  })

  test('the string bytes are readable through c@ at the pushed address', () => {
    const f = new Forth()
    f.interpret(': g s" AB" ;')
    // g leaves ( c-addr 2 ); drop len, c@ -> 65 ('A')
    expect(f.interpret('g drop c@').stack).toEqual([65])
  })
})

describe('." inline print (§V.20)', () => {
  test('." prints its text at run time', () => {
    const f = new Forth()
    const r = f.interpret(': hello ." world" ; hello')
    expect(r.output).toBe('world')
    expect(r.throwCode).toBeNull()
  })

  test('code after ." still runs (ip realigned)', () => {
    const f = new Forth()
    const r = f.interpret(': t ." ab" 5 . ; t')
    expect(r.output).toBe('ab5 ')
    expect(r.throwCode).toBeNull()
  })

  test('." interleaves with other output in definition order', () => {
    const f = new Forth()
    const r = f.interpret(': t ." a" 1 . ." b" 2 . ; t')
    expect(r.output).toBe('a1 b2 ')
  })

  test('." outside a definition -> THROW -14 (compile-only, §V.23)', () => {
    const f = new Forth()
    expect(f.interpret('." hi"').throwCode).toBe(-14)
  })
})
