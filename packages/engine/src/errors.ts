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
export const THROW_DICT_OVERFLOW = -8 // §V.7 alloc reaches exec-harness region
export const THROW_INVALID_ADDR = -9 // memory address out of range
export const THROW_UNALIGNED = -23 // §V.6 cell access on a non-CELL-aligned address
