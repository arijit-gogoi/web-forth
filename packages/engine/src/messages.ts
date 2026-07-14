// @web-forth/engine — gforth-style THROW-code messages (SPEC §T.8, §V.10).
//
// Informative phrasing (§C, grill decision 6): "Undefined word: foo", "Stack
// underflow". The undefined-word message carries the offending token as the
// ForthThrow's `detail`.

import {
  THROW_DICT_OVERFLOW,
  THROW_DIV_ZERO,
  THROW_INVALID_ADDR,
  THROW_RSTACK_OVERFLOW,
  THROW_RSTACK_UNDERFLOW,
  THROW_STACK_OVERFLOW,
  THROW_STACK_UNDERFLOW,
  THROW_STEP_BUDGET,
  THROW_UNALIGNED,
  THROW_UNDEFINED_WORD,
} from './errors'

export const THROW_ABORT = -1

const TEXT: Record<number, string> = {
  [THROW_ABORT]: 'Aborted',
  [THROW_STACK_OVERFLOW]: 'Stack overflow',
  [THROW_STACK_UNDERFLOW]: 'Stack underflow',
  [THROW_RSTACK_OVERFLOW]: 'Return stack overflow',
  [THROW_RSTACK_UNDERFLOW]: 'Return stack underflow',
  [THROW_DICT_OVERFLOW]: 'Dictionary overflow',
  [THROW_INVALID_ADDR]: 'Invalid memory address',
  [THROW_DIV_ZERO]: 'Division by zero',
  [THROW_UNDEFINED_WORD]: 'Undefined word',
  [THROW_UNALIGNED]: 'Address alignment exception',
  [THROW_STEP_BUDGET]: 'Step budget exceeded',
}

// Build the message line for a THROW code (+ optional detail token). Always ends in
// a newline so console output separates cleanly from prior text.
export const messageFor = (code: number, detail?: string): string => {
  const base = TEXT[code]
  if (base === undefined) {
    // Unknown / user THROW code: report the number.
    return `Error ${code}\n`
  }
  if (code === THROW_UNDEFINED_WORD && detail !== undefined) {
    return `${base}: ${detail}\n`
  }
  return `${base}\n`
}
