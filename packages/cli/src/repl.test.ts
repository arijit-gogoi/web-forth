// §T.12 oracle: the REPL core (pure) plus one end-to-end spawn that pipes a .fth on
// stdin and asserts stdout. Proves both the line-at-a-time interactive path and the
// batch/pipe path of §I.cli.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { Repl, formatBatch, runBatch } from './repl'

describe('Repl.feed (interactive line-at-a-time)', () => {
  test('a line that prints tags " ok"', () => {
    const repl = new Repl()
    const feed = repl.feed('1 2 + .')
    expect(feed.text).toBe('3 ok')
    expect(feed.throwCode).toBeNull()
    expect(feed.compiling).toBe(false)
  })

  test('a line with no output is just "ok"', () => {
    const repl = new Repl()
    const feed = repl.feed('1 2 3')
    expect(feed.text).toBe('ok')
  })

  test('an open colon definition reports compiling, then completes', () => {
    const repl = new Repl()
    const open = repl.feed(': square dup')
    expect(open.compiling).toBe(true)
    expect(open.text).toBe('compiled')
    // continues across lines: the definition spans two feeds
    const close = repl.feed('* ;')
    expect(close.compiling).toBe(false)
    expect(close.text).toBe('ok')
    // the word is now usable
    expect(repl.feed('3 square .').text).toBe('9 ok')
  })

  test('a Forth error rides the text as data, not an exception (§V.5)', () => {
    const repl = new Repl()
    const feed = repl.feed('nope')
    expect(feed.throwCode).toBe(-13)
    expect(feed.text.toLowerCase()).toContain('nope')
    // the REPL stays usable after an error
    expect(repl.feed('2 2 + .').text).toBe('4 ok')
  })
})

describe('runBatch + formatBatch (pipe a .fth)', () => {
  test('output then the final stack line', () => {
    const result = runBatch(': sq dup * ; 3 sq . 5 6')
    expect(result.output).toBe('9 ')
    expect(result.stack).toEqual([5, 6])
    expect(formatBatch(result)).toBe('9 \n<2> 5 6')
  })

  test('empty stack renders <0>', () => {
    const result = runBatch('1 2 + .')
    expect(formatBatch(result)).toBe('3 \n<0>')
  })

  test('a batch error sets a non-null throwCode', () => {
    const result = runBatch('5 0 /')
    expect(result.throwCode).toBe(-10)
  })
})

describe('end-to-end: piping a .fth into the bin', () => {
  const entry = resolve(dirname(fileURLToPath(import.meta.url)), 'index.ts')

  test('stdin pipe prints output + stack and exits 0', () => {
    const run = spawnSync('node', ['--import', 'tsx', entry], {
      input: '10 20 + . 1 2 3',
      encoding: 'utf8',
    })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('30 ')
    expect(run.stdout).toContain('<3> 1 2 3')
  })

  test('a Forth throw in a piped buffer exits non-zero', () => {
    const run = spawnSync('node', ['--import', 'tsx', entry], {
      input: 'undefined-word',
      encoding: 'utf8',
    })
    expect(run.status).toBe(1)
  })
})
