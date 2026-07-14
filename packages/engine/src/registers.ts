// @web-forth/engine — VM register set (SPEC §T.2).
//
// Field declarations only; the interpreters wire them in later tasks:
// ip/w/running in §T.5, dsp/rsp in §T.3, state/base/latest/toIn/source in §T.7.

export const STATE_INTERPRET = 0
export const STATE_COMPILE = 1

export interface Registers {
  ip: number // instruction pointer (byte addr into code space)
  w: number // working register (byte addr of the current word's CFA)
  dsp: number // data stack pointer (index) — stack array in §T.3
  rsp: number // return stack pointer (index) — §T.3
  state: number // STATE_INTERPRET | STATE_COMPILE
  latest: number // byte addr of the latest dictionary link field — §T.4
  toIn: number // >IN cursor into the current source
  running: boolean // trampoline flag — §T.5
  source: string // current input buffer (Core JS string)
}

// NOTE: BASE is deliberately NOT a register. It is an authentic Forth memory cell
// (base @ / base ! work); Forth.baseAddr holds its PFA. Single source of truth.
export const makeRegisters = (): Registers => ({
  ip: 0,
  w: 0,
  dsp: 0,
  rsp: 0,
  state: STATE_INTERPRET,
  latest: 0,
  toIn: 0,
  running: false,
  source: '',
})
