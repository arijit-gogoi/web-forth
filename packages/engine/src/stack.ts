// @web-forth/engine — data + return stacks (SPEC §T.3, §V.9).
//
// The two stacks are SEPARATE Int32Array buffers (not in main memory), 1024 cells
// each by default (§C, advisor-settled). This is a conscious fidelity tradeoff:
// DEPTH works, addressable SP@/SP! do not (Extended).
//
// The stack pointer is NOT owned here — it lives on the shared Registers object
// (regs.dsp / regs.rsp), which §I lists as the authoritative stack pointers. Stack
// mutates that register in place, so DOCOL's rpush(ip) / EXIT's ip = rpop() (§T.5)
// move the same counter every other reader (DEPTH, snapshots) sees. Single source
// of truth.
//
// Values are coerced to int32 on push (`| 0`), matching Memory.setCell, so values
// flowing stack<->memory keep one representation.

import {
  ForthThrow,
  THROW_RSTACK_OVERFLOW,
  THROW_RSTACK_UNDERFLOW,
  THROW_STACK_OVERFLOW,
  THROW_STACK_UNDERFLOW,
} from './errors'
import type { Registers } from './registers'

export const DEFAULT_STACK_CELLS = 1024

// Selects which register field this Stack drives.
export type StackPointer = 'dsp' | 'rsp'

export class Stack {
  readonly cells: Int32Array
  readonly capacity: number
  private readonly regs: Registers
  private readonly pointer: StackPointer
  private readonly overflowCode: number
  private readonly underflowCode: number

  constructor(
    regs: Registers,
    pointer: StackPointer,
    overflowCode: number,
    underflowCode: number,
    capacity: number = DEFAULT_STACK_CELLS,
  ) {
    this.regs = regs
    this.pointer = pointer
    this.overflowCode = overflowCode
    this.underflowCode = underflowCode
    this.capacity = capacity
    this.cells = new Int32Array(capacity)
  }

  get depth(): number {
    return this.regs[this.pointer]
  }

  push(value: number): void {
    const sp = this.regs[this.pointer]
    if (sp >= this.capacity) {
      throw new ForthThrow(this.overflowCode, 'stack overflow')
    }
    this.cells[sp] = value | 0
    this.regs[this.pointer] = sp + 1
  }

  pop(): number {
    const sp = this.regs[this.pointer]
    if (sp <= 0) {
      throw new ForthThrow(this.underflowCode, 'stack underflow')
    }
    const next = sp - 1
    this.regs[this.pointer] = next
    return this.cells[next] as number
  }

  // Read the top of stack without popping. Underflows like pop.
  peek(): number {
    const sp = this.regs[this.pointer]
    if (sp <= 0) {
      throw new ForthThrow(this.underflowCode, 'stack underflow')
    }
    return this.cells[sp - 1] as number
  }
}

// Data stack: drives regs.dsp, overflow -3 / underflow -4 (§V.9).
export const makeDataStack = (regs: Registers, capacity: number = DEFAULT_STACK_CELLS): Stack =>
  new Stack(regs, 'dsp', THROW_STACK_OVERFLOW, THROW_STACK_UNDERFLOW, capacity)

// Return stack: drives regs.rsp, overflow -5 / underflow -6 (§V.9).
export const makeReturnStack = (regs: Registers, capacity: number = DEFAULT_STACK_CELLS): Stack =>
  new Stack(regs, 'rsp', THROW_RSTACK_OVERFLOW, THROW_RSTACK_UNDERFLOW, capacity)
