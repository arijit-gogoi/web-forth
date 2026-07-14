#!/usr/bin/env node
// @web-forth/cli entry (SPEC.md §T.12, §I.cli): a headless node REPL over the pure
// @web-forth/engine core. Two modes:
//   - batch: a piped .fth on stdin, or a file argument -> interpret the whole buffer,
//     print output + final stack, exit non-zero on a Forth throw.
//   - interactive: a TTY -> a line-at-a-time prompt with gforth-style " ok".
// The REPL logic lives in repl.ts (pure, tested); this file is only the IO shell.

import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { Repl, formatBatch, runBatch } from './repl'

const readStdin = (): Promise<string> =>
  new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
  })

const runBatchMode = (source: string): void => {
  const result = runBatch(source)
  process.stdout.write(formatBatch(result) + '\n')
  process.exitCode = result.throwCode === null ? 0 : 1
}

const runInteractive = (): void => {
  const repl = new Repl()
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  process.stdout.write('web-forth REPL. Ctrl+D to exit.\n')
  const prompt = (): void => {
    rl.setPrompt(repl.forth.regs.state === 0 ? '> ' : '  ... ')
    rl.prompt()
  }
  prompt()
  rl.on('line', (line) => {
    const feed = repl.feed(line)
    if (feed.text.length > 0) {
      process.stdout.write(feed.text.endsWith('\n') ? feed.text : feed.text + '\n')
    }
    prompt()
  })
  rl.on('close', () => {
    process.stdout.write('\n')
    process.exit(0)
  })
}

const main = async (): Promise<void> => {
  const fileArg = process.argv[2]
  if (fileArg !== undefined) {
    runBatchMode(readFileSync(fileArg, 'utf8'))
    return
  }
  if (!process.stdin.isTTY) {
    runBatchMode(await readStdin())
    return
  }
  runInteractive()
}

void main()
