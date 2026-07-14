import { describe, expect, test } from 'vitest'
import { ForthThrow } from './errors'
import { makeRegisters } from './registers'
import { DEFAULT_STACK_CELLS, makeDataStack, makeReturnStack } from './stack'

const codeOf = (fn: () => unknown): number => {
  try {
    fn()
  } catch (error) {
    return (error as ForthThrow).code
  }
  return 0
}

describe('data stack', () => {
  test('push/pop is LIFO and moves regs.dsp (single source of truth)', () => {
    const regs = makeRegisters()
    const s = makeDataStack(regs)
    expect(s.depth).toBe(0)
    s.push(10)
    s.push(20)
    expect(regs.dsp).toBe(2) // stack mutated the shared register, not a private sp
    expect(s.depth).toBe(2)
    expect(s.peek()).toBe(20)
    expect(s.pop()).toBe(20)
    expect(s.pop()).toBe(10)
    expect(regs.dsp).toBe(0)
  })

  test('push coerces to signed int32', () => {
    const s = makeDataStack(makeRegisters())
    s.push(0x1_0000_0000 + 5) // wraps to 5
    expect(s.pop()).toBe(5)
    s.push(0xffffffff) // -1 as int32
    expect(s.pop()).toBe(-1)
  })

  // §V.9
  test('overflow at capacity+1 → THROW -3', () => {
    const s = makeDataStack(makeRegisters(), 1024)
    for (let i = 0; i < 1024; i++) s.push(i) // fill to capacity — ok
    expect(s.depth).toBe(1024)
    expect(codeOf(() => s.push(999))).toBe(-3) // one past capacity
  })

  // §V.9
  test('underflow on empty pop → THROW -4', () => {
    const s = makeDataStack(makeRegisters())
    expect(codeOf(() => s.pop())).toBe(-4)
    expect(codeOf(() => s.peek())).toBe(-4)
  })
})

describe('return stack', () => {
  test('push/pop moves regs.rsp', () => {
    const regs = makeRegisters()
    const s = makeReturnStack(regs)
    s.push(42)
    expect(regs.rsp).toBe(1)
    expect(s.pop()).toBe(42)
    expect(regs.rsp).toBe(0)
  })

  // §V.9
  test('overflow at capacity+1 → THROW -5', () => {
    const s = makeReturnStack(makeRegisters(), 1024)
    for (let i = 0; i < 1024; i++) s.push(i)
    expect(codeOf(() => s.push(0))).toBe(-5)
  })

  // §V.9
  test('underflow on empty pop → THROW -6', () => {
    const s = makeReturnStack(makeRegisters())
    expect(codeOf(() => s.pop())).toBe(-6)
  })
})

test('data and return stacks are independent buffers and pointers', () => {
  const regs = makeRegisters()
  const d = makeDataStack(regs)
  const r = makeReturnStack(regs)
  d.push(1)
  d.push(2)
  r.push(9)
  expect(regs.dsp).toBe(2)
  expect(regs.rsp).toBe(1)
  expect(d.cells).not.toBe(r.cells)
  expect(d.pop()).toBe(2) // return stack push did not disturb the data stack
  expect(r.pop()).toBe(9)
})

test('default capacity is DEFAULT_STACK_CELLS', () => {
  expect(DEFAULT_STACK_CELLS).toBe(1024)
  const s = makeDataStack(makeRegisters())
  expect(s.capacity).toBe(1024)
})
