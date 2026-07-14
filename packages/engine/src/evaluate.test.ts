// EVALUATE (SPEC §T.24, §V.18). evaluate ( c-addr u -- ) interprets a counted
// string as Forth source through a nested text-interpret (a §V.1 carve-out). It
// reuses the shared token loop over a temporary source with the enclosing parse
// state saved+restored, so the caller's tokenizing resumes cleanly. It does NOT call
// the public interpret() (which would wipe output + reset >IN). The evaluated text is
// stack-transparent and its definitions persist; a throw propagates to the caller.
//
// The string operand comes from s" (compile-only), so these run inside definitions.

import { describe, expect, test } from 'vitest'
import { Forth } from './forth'

describe('evaluate basics (§V.18)', () => {
  test('evaluate runs the string and its stack results stand (transparent)', () => {
    const f = new Forth()
    // : t s" 2 3 +" evaluate ;  -> leaves 5 (evaluate is stack-transparent)
    const r = f.interpret(': t s" 2 3 +" evaluate ; t')
    expect(r.stack).toEqual([5])
    expect(r.throwCode).toBeNull()
  })

  test('evaluate output goes to the same sink', () => {
    const f = new Forth()
    const r = f.interpret(': t s" 42 ." evaluate ; t')
    expect(r.output).toBe('42 ')
  })
})

describe('parse state does not leak (§V.18 — the critical restore)', () => {
  test('the caller keeps tokenizing after evaluate returns', () => {
    const f = new Forth()
    // : t s" 99 " evaluate ; t 7 .   The outer "7 ." only parses if source/>IN were
    // restored after the nested evaluate. If they leak, 7 . never runs -> empty out.
    const r = f.interpret(': t s" 99 " evaluate ; t 7 .')
    expect(r.output).toBe('7 ')
    expect(r.stack).toEqual([99])
  })

  test('accumulated output is preserved across evaluate (not wiped)', () => {
    const f = new Forth()
    // : t 1 . s" 2 ." evaluate 3 . ; t  -> "1 2 3 ". A public interpret() call inside
    // evaluate would wipe output and drop the "1 ".
    const r = f.interpret(': t 1 . s" 2 ." evaluate 3 . ; t')
    expect(r.output).toBe('1 2 3 ')
  })
})

describe('evaluate compiles / defines (state persists, §V.18)', () => {
  test('a definition made inside evaluate persists and is callable after', () => {
    const f = new Forth()
    // : def s" : sq dup * ;" evaluate ;  def  then 3 sq . uses the new word
    f.interpret(': def s" : sq dup * ;" evaluate ; def')
    const r = f.interpret('3 sq .')
    expect(r.output).toBe('9 ')
  })

  test('evaluate at top level (interpret state) also works', () => {
    const f = new Forth()
    // s" is compile-only, so build the string with a helper that returns ( c-addr u )
    f.interpret(': msg s" 10 20 * " ;')
    const r = f.interpret('msg evaluate .')
    expect(r.output).toBe('200 ')
  })
})

describe('evaluate error propagation (§V.18)', () => {
  test('a throw inside evaluate propagates to the top-level handler', () => {
    const f = new Forth()
    // nope is undefined -> -13 propagates out of evaluate to the interpreter handler
    const r = f.interpret(': bad s" nope" evaluate ; bad')
    expect(r.throwCode).toBe(-13)
  })

  test('evaluate errors are catchable (composes with T21 catch)', () => {
    const f = new Forth()
    f.interpret(': bad s" nope" evaluate ;')
    // : safe ['] bad catch ; safe .  -> catch absorbs -13, prints it, RunResult clean
    const r = f.interpret(": safe ['] bad catch ; safe .")
    expect(r.output).toBe('-13 ')
    expect(r.throwCode).toBeNull()
  })

  test('parse state is restored even when evaluate throws (finally path)', () => {
    const f = new Forth()
    // bad throws inside evaluate; a catch absorbs it; the caller must then keep
    // parsing. : t ['] bad catch drop 5 . ;  -> after the caught throw, 5 . runs.
    f.interpret(': bad s" nope" evaluate ;')
    const r = f.interpret(": t ['] bad catch drop 5 . ; t")
    expect(r.output).toBe('5 ')
    expect(r.throwCode).toBeNull()
  })
})
