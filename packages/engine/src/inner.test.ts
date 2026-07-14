import { beforeEach, describe, expect, test } from 'vitest'
import { ForthThrow } from './errors'
import { BOOT_RESERVED } from './dictionary'
import { DOCOL, DOCONST, DOVAR, EXIT, HALT_XT, Inner } from './inner'
import { CELL, Memory } from './memory'
import { makeRegisters } from './registers'
import { makeDataStack, makeReturnStack } from './stack'

// Build a fresh inner-interpreter context plus a cell assembler that allots ABOVE the
// reserved boot cell at address 0 (never clobbering HALT's CFA there).
const setup = (stepBudget?: number) => {
  const mem = new Memory()
  const regs = makeRegisters()
  const dstack = makeDataStack(regs)
  const rstack = makeReturnStack(regs)
  const vm = new Inner(mem, regs, dstack, rstack, stepBudget)

  // Reserve the boot cell (addr 0 holds HALT), matching the Dictionary invariant, so
  // hand-assembled threads never overwrite HALT.
  if (mem.here < BOOT_RESERVED) {
    mem.allot(BOOT_RESERVED - mem.here)
  }

  // Allot one cell and write `value`; returns its address (a stable CFA/thread cell).
  const put = (value: number): number => {
    const at = mem.allot(CELL)
    mem.setCell(at, value)
    return at
  }
  // A primitive word: CFA cell holds a routine index; its address is the xt.
  const prim = (routine: (v: Inner) => void): number => put(vm.addRoutine(routine))
  const lit = (n: number): number => prim((v) => v.dstack.push(n))

  return { mem, regs, dstack, rstack, vm, put, prim, lit }
}

describe('inner interpreter', () => {
  let s: ReturnType<typeof setup>
  beforeEach(() => {
    s = setup()
  })

  // §V.1 HALT self-consistency: HALT registered first -> index 0 -> cell(0)==HALT.
  test('HALT is index 0 and cell(0) dispatches to it', () => {
    expect(s.vm.haltIndex).toBe(0)
    expect(HALT_XT).toBe(0)
    expect(s.mem.cellAt(HALT_XT)).toBe(s.vm.haltIndex) // boot wrote it explicitly
  })

  // §V.1 primitive path: routine runs, NEXT hits HALT slot, loop stops.
  test('execute() of a primitive xt terminates with rsp at baseline', () => {
    const xt = s.prim((v) => v.dstack.push(42))
    s.vm.execute(xt)
    expect(s.regs.running).toBe(false)
    expect(s.dstack.pop()).toBe(42)
    expect(s.regs.rsp).toBe(0) // return stack balanced
  })

  // §V.1 colon path (single + nested): DOCOL pushes return addr, body runs, EXIT
  // pops back, HALT stops. Nesting proves the flat while never recurses.
  test('nested colon words return the correct result with rsp balanced', () => {
    const { vm, put, prim, lit, dstack, regs } = s
    const docol = vm.addRoutine(DOCOL)
    const EXIT_XT = prim(EXIT)
    const ADD_XT = prim((v) => {
      const b = v.dstack.pop()
      const a = v.dstack.pop()
      v.dstack.push(a + b)
    })
    const LIT2_XT = lit(2)
    const LIT3_XT = lit(3)
    const LIT10_XT = lit(10)

    // inner colon: : five 2 3 + ;  ->  [DOCOL][LIT2][LIT3][ADD][EXIT]
    const FIVE_XT = put(docol)
    put(LIT2_XT)
    put(LIT3_XT)
    put(ADD_XT)
    put(EXIT_XT)

    // outer colon: : t 10 five + ;  ->  [DOCOL][LIT10][FIVE][ADD][EXIT]
    const T_XT = put(docol)
    put(LIT10_XT)
    put(FIVE_XT) // calls the inner colon -> nesting
    put(ADD_XT)
    put(EXIT_XT)

    vm.execute(T_XT)
    expect(regs.running).toBe(false)
    expect(dstack.pop()).toBe(15) // 10 + (2 + 3)
    expect(regs.rsp).toBe(0) // fully unwound
  })

  // §V.11 offset consistency: DOVAR pushes w + 2*CELL (== toBody).
  test('DOVAR pushes the parameter field (w + 2*CELL)', () => {
    const { vm, put, dstack } = s
    const dovar = vm.addRoutine(DOVAR)
    const cfa = put(dovar) // [CFA=DOVAR]
    put(0) // [doesCodeAddr] (2-slot layout)
    vm.execute(cfa)
    expect(dstack.pop()).toBe(cfa + 2 * CELL)
  })

  // DOCONST pushes cell(w + CELL).
  test('DOCONST pushes the value one cell after the CFA', () => {
    const { vm, put, dstack } = s
    const doconst = vm.addRoutine(DOCONST)
    const cfa = put(doconst)
    put(1234) // stored value
    vm.execute(cfa)
    expect(dstack.pop()).toBe(1234)
  })

  // §V.8 non-reentrant harness: two sequential executes each terminate, rsp baseline.
  test('two sequential execute() calls each terminate cleanly', () => {
    const { vm, prim, dstack, regs } = s
    const a = prim((v) => v.dstack.push(1))
    const b = prim((v) => v.dstack.push(2))
    vm.execute(a)
    expect(regs.rsp).toBe(0)
    vm.execute(b)
    expect(regs.rsp).toBe(0)
    expect(dstack.pop()).toBe(2)
    expect(dstack.pop()).toBe(1)
  })

  // §V.14 step budget: a routine that resets ip to the harness loops forever -> -28.
  test('runaway loop exceeds step budget -> THROW -28', () => {
    const t = setup(1000) // small budget
    const cfa = t.prim((v) => {
      v.regs.ip = v.mem.harness // jump back to the harness start every step
    })
    let code = 0
    try {
      t.vm.execute(cfa)
    } catch (error) {
      code = (error as ForthThrow).code
    }
    expect(code).toBe(-28)
  })
})
