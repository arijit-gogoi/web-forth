// @web-forth/client Forth syntax mode for CodeMirror 6 (SPEC.md §T.26, §R.2). Forth is
// whitespace-delimited with no nested grammar, so a CM5-style StreamLanguage tokenizer fits
// (no Lezer grammar needed). The tokenizer classifies each token and returns a standard
// highlight token-type name; defaultHighlightStyle (theme-aware) maps those names to colors.
//
// Token order matters: the special forms (\ ( s" .") start with characters a generic
// non-space word grab would swallow, so they are checked FIRST. Every branch advances the
// stream (a branch that peeks without consuming hangs CodeMirror), with stream.next() as a
// belt-and-suspenders fallback. The `:` -> definition-name link is stateful, so the state
// is copied per line (copyState) to avoid leaking across lines.

import { StreamLanguage } from '@codemirror/language'
import type { StreamParser, StringStream } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'

// Structural / compiling words get the keyword tag. Kept deliberately small: user words and
// ordinary prelude words fall through to the default token (no highlight), which is correct.
// Exported for the §V.28 subset guard test (forthLanguage.test.ts), which asserts every
// entry resolves in the engine so a highlighted word can never be one the engine THROWs on.
export const KEYWORDS = new Set<string>([
  ':',
  ';',
  'if',
  'else',
  'then',
  'begin',
  'until',
  'again',
  'while',
  'repeat',
  'do',
  '?do',
  'loop',
  '+loop',
  'leave',
  'case',
  'of',
  'endof',
  'endcase',
  'immediate',
  'variable',
  'constant',
  'create',
  'does>',
  'literal',
  'recurse',
  '[',
  ']',
  "[']",
  '[char]',
])

interface ForthTokenState {
  // True right after a `:` token: the next word is a definition name.
  afterColon: boolean
}

// A whitespace-delimited Forth token (non-space run). Used to classify plain words.
const WORD = /^\S+/

const startState = (): ForthTokenState => ({ afterColon: false })

const copyState = (state: ForthTokenState): ForthTokenState => ({ afterColon: state.afterColon })

// Advance the stream to just past `close` (or to end of line if it never appears).
// Shared by the paren-comment and string scanners; the opener is already consumed.
const consumeTo = (stream: StringStream, close: string): void => {
  while (!stream.eol()) {
    if (stream.next() === close) {
      return
    }
  }
}

// A number in the engine's syntax: a signed integer, or a $-prefixed hex literal.
const isNumber = (word: string): boolean =>
  /^[+-]?\d+$/.test(word) || /^[+-]?\$[0-9a-f]+$/.test(word)

// Classify a plain whitespace-delimited token (already matched + lowercased). Sets
// afterColon when the token is `:` so the next word is tagged as a definition name.
const classifyWord = (word: string, state: ForthTokenState): string | null => {
  if (word === ':') {
    state.afterColon = true
    return 'keyword'
  }
  if (KEYWORDS.has(word)) {
    return 'keyword'
  }
  if (isNumber(word)) {
    return 'number'
  }
  return null // user/prelude words: no highlight
}

const token = (stream: StringStream, state: ForthTokenState): string | null => {
  // Whitespace: consume and emit no token.
  if (stream.eatSpace()) {
    return null
  }

  const ch = stream.peek()

  // Line comment: \ to end of line (the engine treats a leading \ token as a comment).
  if (ch === '\\') {
    stream.skipToEnd()
    return 'comment'
  }

  // Paren comment: ( ... ) on one line. Consume through the closing paren (or to end).
  if (ch === '(') {
    stream.next() // consume '('
    consumeTo(stream, ')')
    return 'comment'
  }

  // String words: s" ... " and ." ... " . The opening word is s"/." then text to the
  // close quote. Only when the quote form actually starts here, else fall through.
  if (stream.match(/^(s"|\.")/)) {
    consumeTo(stream, '"')
    state.afterColon = false
    return 'string'
  }

  // A definition name: the token right after a `:`. Uses the legacy `def` token name
  // (not `definition`), which defaultHighlightStyle colors distinctly from plain words.
  if (state.afterColon) {
    state.afterColon = false
    if (stream.match(WORD)) {
      return 'def'
    }
    stream.next() // safety: always advance
    return null
  }

  // A plain whitespace-delimited token: classify it, or advance safely if none matched.
  const matched = stream.match(WORD)
  if (matched === null || matched === false) {
    stream.next() // safety: never return without consuming
    return null
  }
  return classifyWord(stream.current().toLowerCase(), state)
}

export const forthStreamParser: StreamParser<ForthTokenState> = {
  name: 'forth',
  startState,
  copyState,
  token,
}

const forthLanguage = StreamLanguage.define(forthStreamParser)

// The editor extension bundle for Forth: the language plus the One Dark theme. oneDark
// bundles the editor chrome and a matched dark highlight style that colors the standard
// token names the tokenizer returns (keyword, comment, number, string, def), distinctly
// and readably on a dark background (§T.26).
export const forthLanguageSupport: Array<Extension> = [forthLanguage, oneDark]
