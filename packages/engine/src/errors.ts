// @web-forth/engine — error primitives.
//
// Forth THROW is a JS exception carrying an integer code. The outer interpreter
// catches it, prints a message, ABORTs, and continues (full CATCH/ABORT/messages
// land in SPEC §T.8). Forth errors ride the success channel as data (§V.5); only a
// ForthFault (genuine VM invariant violation) reaches the Effect E-channel.

export class ForthThrow extends Error {
  readonly code: number
  readonly detail: string | undefined

  constructor(code: number, detail?: string) {
    super(`Forth THROW ${code}${detail ? `: ${detail}` : ''}`)
    this.name = 'ForthThrow'
    this.code = code
    this.detail = detail
  }
}

export class ForthFault extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForthFault'
  }
}

// Throw codes used so far. The full standard table is assembled in §T.8.
export const THROW_STACK_OVERFLOW = -3 // §V.9 data stack push past capacity
export const THROW_STACK_UNDERFLOW = -4 // §V.9 data stack pop when empty
export const THROW_RSTACK_OVERFLOW = -5 // §V.9 return stack push past capacity
export const THROW_RSTACK_UNDERFLOW = -6 // §V.9 return stack pop when empty
export const THROW_DICT_OVERFLOW = -8 // §V.7 alloc reaches exec-harness region
export const THROW_INVALID_ADDR = -9 // memory address out of range
export const THROW_DIV_ZERO = -10 // §V.9 division by zero (/ mod /mod)
export const THROW_UNDEFINED_WORD = -13 // §V.9 outer interpreter: word not found and not a number
export const THROW_UNALIGNED = -23 // §V.6 cell access on a non-CELL-aligned address
export const THROW_STEP_BUDGET = -28 // §V.9/§V.14 inner-loop step budget exceeded
