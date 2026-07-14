// @web-forth/engine — inner interpreter: ITC dispatch + NEXT trampoline (SPEC §T.5,
// §V.1, §V.8, §V.14).
//
// Indirect-threaded, routine-index dispatch. A word's CODE FIELD cell holds a small
// integer, an index into `code: Array<Routine>` of behavior routines. NEXT fetches
// the next xt (a CFA address) from the thread and dispatches on the routine index
// stored at that CFA:
//
//   w = cell(ip); ip += CELL; vm.w = w
//   code[cell(w)](vm)
//
// §V.1: the inner interpreter is a SINGLE flat `while` loop. Behavior routines never
// recurse into run(); they mutate stacks and/or ip and return void. This is the only
// thing that keeps deep colon nesting off the JS call stack.
//
// §V.8: execute() drives the loop through a fixed 2-cell exec harness [xt][HALT_XT].
// It is non-reentrant (single harness); the outer interpreter runs tokens in order.
//
// §V.14: run() enforces a per-execution step budget; exceeding it throws -28 (keeps
// the main thread responsive; a true interrupt via Web Worker is v2).

import { ForthThrow, THROW_STEP_BUDGET } from './errors'
import { CELL, Memory } from './memory'
import type { Registers } from './registers'
import type { Stack } from './stack'

// The exec harness's HALT slot points at a real CFA cell whose routine index is
// HALT. That cell is the reserved boot cell at address 0 (§T.4). HALT is registered
// FIRST below, so HALT_INDEX == 0, and the zero-initialized cell(0) already reads as
// HALT_INDEX; boot writes it explicitly for hygiene and asserts the agreement.
export const HALT_XT = 0

// Default inner-loop step budget (§V.14). Configurable; not surfaced in the UI.
export const DEFAULT_STEP_BUDGET = 5_000_000

// A behavior routine mutates the VM and returns void. Never recurses into run().
export type Routine = (vm: Inner) => void

// The execution context the inner interpreter and its routines close over. The full
// class Forth (§T.7/§T.11) composes this; T5 provides the inner core as a unit.
export class Inner {
  readonly mem: Memory
  readonly regs: Registers
  readonly dstack: Stack
  readonly rstack: Stack
  readonly code: Array<Routine> = []
  readonly haltIndex: number
  stepBudget: number

  constructor(
    mem: Memory,
    regs: Registers,
    dstack: Stack,
    rstack: Stack,
    stepBudget: number = DEFAULT_STEP_BUDGET,
  ) {
    this.mem = mem
    this.regs = regs
    this.dstack = dstack
    this.rstack = rstack
    this.stepBudget = stepBudget

    // Register HALT first so its index is 0, matching HALT_XT's target cell.
    this.haltIndex = this.addRoutine(HALT)
    // Install HALT's routine index into the reserved boot cell (HALT_XT = 0).
    this.mem.setCell(HALT_XT, this.haltIndex)
  }

  // Reset the code table to just HALT (index 0) and rewrite the boot cell. Used by
  // Forth.reset() before re-installing primitives, so routines do not accumulate.
  installHalt(): void {
    this.code.length = 0
    this.code.push(HALT)
    this.mem.setCell(HALT_XT, this.haltIndex)
  }

  // Register a behavior routine, returning its index (the value stored in a CFA).
  addRoutine(routine: Routine): number {
    this.code.push(routine)
    return this.code.length - 1
  }

  // NEXT step, run in a single flat while loop. Behavior routines never call this.
  run(): void {
    const { regs, mem, code } = this
    let steps = 0
    regs.running = true
    while (regs.running) {
      if (++steps > this.stepBudget) {
        throw new ForthThrow(THROW_STEP_BUDGET, 'step budget exceeded')
      }
      const w = mem.cellAt(regs.ip) // next xt (a CFA address)
      regs.ip += CELL
      regs.w = w
      code[mem.cellAt(w)]!(this) // dispatch on the CFA's routine index
    }
  }

  // Drive one execution token to completion via the 2-cell exec harness. Resets the
  // step budget per execution (catches a single runaway word). Non-reentrant (§V.8).
  //
  // NOT the EXECUTE word: the EXECUTE word (added later) dispatches inline inside the
  // live trampoline and must never call this recursively (§V.1).
  execute(xt: number): void {
    const harness = this.mem.harness
    this.mem.setCell(harness, xt)
    this.mem.setCell(harness + CELL, HALT_XT)
    this.regs.ip = harness
    this.run()
  }
}

// --- Behavior routines (none recurse into run(); mutate and return) ---

// HALT: stop the trampoline, return control to JS. Registered first (index 0).
export const HALT: Routine = (vm) => {
  vm.regs.running = false
}

// DOCOL: enter a colon body. Push the return address, thread into the body at w+CELL.
export const DOCOL: Routine = (vm) => {
  vm.rstack.push(vm.regs.ip)
  vm.regs.ip = vm.regs.w + CELL
}

// EXIT: return from a colon body.
export const EXIT: Routine = (vm) => {
  vm.regs.ip = vm.rstack.pop()
}

// DOVAR: push the parameter field address (CREATE 2-slot layout: w + 2*CELL).
export const DOVAR: Routine = (vm) => {
  vm.dstack.push(vm.regs.w + 2 * CELL)
}

// DOCONST: push the value stored one cell after the CFA.
export const DOCONST: Routine = (vm) => {
  vm.dstack.push(vm.mem.cellAt(vm.regs.w + CELL))
}
