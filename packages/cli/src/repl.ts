// @web-forth/cli REPL core (SPEC.md §T.12, §I.cli). Pure, side-effect-free over a
// single Forth instance so it is unit-testable without spawning a process. The entry
// (index.ts) wires this to stdin/stdout/readline; batch mode pipes a whole .fth.

import { Forth, STATE_COMPILE } from '@web-forth/engine'

// A gforth-style prompt acknowledgement. Interactive Forth prints " ok" after a line
// that leaves the interpreter in interpret state; a line that opens a colon definition
// stays in compile state and gets a continuation prompt instead.
export const OK = 'ok'
export const COMPILE_PROMPT = 'compiled'

export interface FeedResult {
  // Text to print for this line: the run output, then a status word. No trailing
  // newline (the caller owns line breaks).
  readonly text: string
  // The Forth throw code for the line, or null on success. Non-null still rides here
  // as data (§V.5): a Forth error is not an exception.
  readonly throwCode: number | null
  // True when the interpreter is mid-definition (compile state) and expects more input.
  readonly compiling: boolean
}

// Render one interpret() result as REPL text: the emitted output followed by the
// status token. On error the output already carries the gforth message (§V.10), so we
// just append it; on success we tag " ok" (or "compiled" while a definition is open).
const render = (output: string, throwCode: number | null, compiling: boolean): string => {
  if (throwCode !== null) {
    // output ends with the error message + newline (messageFor appends "\n").
    return output
  }
  const status = compiling ? COMPILE_PROMPT : OK
  if (output === '') {
    return status
  }
  // `.` and friends already emit a trailing space, so only add a separator when the
  // output does not already end in whitespace. Avoids "9  ok" (double space).
  const separator = /\s$/.test(output) ? '' : ' '
  return `${output}${separator}${status}`
}

// A stateful REPL over one Forth. `feed` runs a single source line and reports what to
// print plus whether a definition is still open across lines.
export class Repl {
  readonly forth: Forth

  constructor(forth: Forth = new Forth()) {
    this.forth = forth
  }

  feed(line: string): FeedResult {
    const result = this.forth.interpret(line)
    const compiling = this.forth.regs.state === STATE_COMPILE
    return {
      text: render(result.output, result.throwCode, compiling),
      throwCode: result.throwCode,
      compiling,
    }
  }

  reset(): void {
    this.forth.reset()
  }
}

// Batch mode: interpret a whole buffer at once (a piped .fth file). Returns the raw
// output, the final data stack (bottom-to-top), and the throw code. The interpreter
// runs the buffer as one unit, so a multi-line colon definition works without any
// line-splitting here.
export interface BatchResult {
  readonly output: string
  readonly stack: ReadonlyArray<number>
  readonly throwCode: number | null
}

export const runBatch = (source: string, forth: Forth = new Forth()): BatchResult => {
  const result = forth.interpret(source)
  return { output: result.output, stack: result.stack, throwCode: result.throwCode }
}

// Format a batch result for stdout: the program output, then a ".s"-style stack line so
// piping a file shows both what it printed and what it left on the stack.
export const formatBatch = (result: BatchResult): string => {
  const depth = result.stack.length
  const stackLine = `<${depth}>${depth === 0 ? '' : ' ' + result.stack.join(' ')}`
  const out = result.output.length === 0 ? '' : result.output
  return `${out}${out.endsWith('\n') || out === '' ? '' : '\n'}${stackLine}`
}
