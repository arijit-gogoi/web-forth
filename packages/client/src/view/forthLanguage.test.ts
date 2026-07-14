// Forth syntax-mode tokenizer (SPEC §T.26, §R.2). The StreamLanguage token() classifies
// each whitespace-delimited token; these tests drive a StringStream over a source line and
// assert the (tokenType, text) sequence. This makes tokenizer CORRECTNESS test-gated; the
// browser only confirms the colors render and the T19/T25 behaviors still work.

import { StringStream } from '@codemirror/language'
import { describe, expect, test } from 'vitest'
import { forthStreamParser } from './forthLanguage'

// Tokenize one line into [tokenType | null, text] pairs. Mirrors how CodeMirror drives the
// parser: repeatedly call token(), reading stream.current() for the consumed text. Guards
// against a non-advancing token() (which would hang the editor) by failing on no progress.
const tokenize = (line: string): Array<readonly [string | null, string]> => {
  const stream = new StringStream(line, 2, 2)
  const state = forthStreamParser.startState!(2)
  const out: Array<readonly [string | null, string]> = []
  let guard = 0
  while (!stream.eol()) {
    const before = stream.pos
    const type = forthStreamParser.token(stream, state)
    if (stream.pos === before) {
      throw new Error(`token() did not advance at pos ${before} in ${JSON.stringify(line)}`)
    }
    const text = stream.current()
    if (text.trim().length > 0) {
      out.push([type, text] as const)
    }
    stream.start = stream.pos
    guard += 1
    if (guard > 1000) throw new Error('tokenizer runaway')
  }
  return out
}

// Convenience: just the non-whitespace token types, in order.
const types = (line: string): Array<string | null> => tokenize(line).map(([type]) => type)

describe('keywords and definitions (§T.26)', () => {
  test(': marks a colon keyword and the following word as a definition', () => {
    const pairs = tokenize(': square dup * ;')
    expect(pairs).toContainEqual(['keyword', ':'])
    expect(pairs).toContainEqual(['def', 'square'])
    expect(pairs).toContainEqual(['keyword', ';'])
  })

  test('the definition tag applies only to the name, not later words', () => {
    const pairs = tokenize(': foo bar baz ;')
    expect(pairs).toContainEqual(['def', 'foo'])
    // bar and baz are ordinary words -> no highlight
    expect(pairs).toContainEqual([null, 'bar'])
    expect(pairs).toContainEqual([null, 'baz'])
  })

  test('control-flow words are keywords', () => {
    for (const word of ['if', 'else', 'then', 'begin', 'until', 'do', 'loop', '?do', '+loop']) {
      expect(types(word)).toEqual(['keyword'])
    }
  })

  test('user and prelude words are not highlighted', () => {
    expect(types('dup drop swap over')).toEqual([null, null, null, null])
  })
})

describe('numbers (§T.26)', () => {
  test('decimal integers are numbers', () => {
    expect(types('42')).toEqual(['number'])
    expect(types('-17')).toEqual(['number'])
  })

  test('a $-prefixed hex literal is a number', () => {
    expect(types('$1f')).toEqual(['number'])
  })

  test('a word that merely contains digits is not a number', () => {
    expect(types('2dup')).toEqual([null]) // starts with a digit but is a word
  })
})

describe('comments (§T.26)', () => {
  test('a backslash comment runs to end of line', () => {
    const pairs = tokenize('\\ this is a comment')
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.[0]).toBe('comment')
  })

  test('a paren comment is one comment token', () => {
    const pairs = tokenize('( a b c )')
    expect(pairs[0]?.[0]).toBe('comment')
    expect(pairs[0]?.[1]).toBe('( a b c )')
  })

  test('code after a paren comment is tokenized normally', () => {
    const pairs = tokenize('( note ) 42')
    expect(pairs).toContainEqual(['comment', '( note )'])
    expect(pairs).toContainEqual(['number', '42'])
  })
})

describe('strings (§T.26)', () => {
  test('s" ... " is a string token', () => {
    const pairs = tokenize('s" hello"')
    expect(pairs[0]?.[0]).toBe('string')
  })

  test('." ... " is a string token', () => {
    const pairs = tokenize('." world"')
    expect(pairs[0]?.[0]).toBe('string')
  })

  test('code after a string is tokenized normally', () => {
    const pairs = tokenize(': t s" hi" 42 ;')
    expect(pairs).toContainEqual(['string', 's" hi"'])
    expect(pairs).toContainEqual(['number', '42'])
  })
})

describe('tokenizer always advances (no hang, §T.26)', () => {
  test('a line of only special chars does not hang', () => {
    // If any branch peeked without consuming, tokenize would throw on no-progress.
    expect(() => tokenize('( ) \\ : ; s" x"')).not.toThrow()
  })

  test('an empty line yields no tokens', () => {
    expect(tokenize('')).toEqual([])
  })

  test('trailing/leading whitespace is handled', () => {
    expect(types('   42   ')).toEqual(['number'])
  })
})
