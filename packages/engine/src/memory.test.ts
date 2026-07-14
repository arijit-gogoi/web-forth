import { describe, expect, test } from 'vitest'
import { ForthThrow } from './errors'
import { CELL, DEFAULT_MEM_SIZE, Memory } from './memory'

describe('Memory', () => {
  test('default size + views share one buffer', () => {
    const m = new Memory()
    expect(m.size).toBe(DEFAULT_MEM_SIZE)
    expect(m.cells.buffer).toBe(m.buffer)
    expect(m.bytes.buffer).toBe(m.buffer)
    expect(m.harness).toBe(DEFAULT_MEM_SIZE - 2 * CELL)
    expect(m.here).toBe(0)
  })

  test('cell read/write roundtrip (signed int32)', () => {
    const m = new Memory()
    m.setCell(8, -123456)
    expect(m.cellAt(8)).toBe(-123456)
    m.setCell(8, 0x7fffffff)
    expect(m.cellAt(8)).toBe(0x7fffffff)
  })

  test('byte read/write roundtrip', () => {
    const m = new Memory()
    m.setByte(10, 0xab)
    expect(m.byteAt(10)).toBe(0xab)
    m.setByte(10, 0x1ff) // truncates to 0xff
    expect(m.byteAt(10)).toBe(0xff)
  })

  // §V.6
  test('cell access requires 4-aligned address → THROW -23', () => {
    const m = new Memory()
    expect(() => m.cellAt(1)).toThrow(ForthThrow)
    expect(() => m.setCell(2, 0)).toThrow(ForthThrow)
    let code = 0
    try {
      m.cellAt(3)
    } catch (error) {
      code = (error as ForthThrow).code
    }
    expect(code).toBe(-23)
    // aligned addresses are fine
    expect(() => m.cellAt(0)).not.toThrow()
    expect(() => m.cellAt(4)).not.toThrow()
  })

  // §V.7
  test('allot into exec-harness region → THROW -8', () => {
    const m = new Memory(64) // harness at 64 - 8 = 56
    expect(m.harness).toBe(56)
    expect(m.allot(56)).toBe(0) // fill exactly up to harness — ok
    expect(m.here).toBe(56)
    let code = 0
    try {
      m.allot(CELL) // one more cell reaches the harness
    } catch (error) {
      code = (error as ForthThrow).code
    }
    expect(code).toBe(-8)
  })

  test('allot returns start addr and advances here', () => {
    const m = new Memory()
    expect(m.allot(4)).toBe(0)
    expect(m.allot(4)).toBe(4)
    expect(m.here).toBe(8)
  })

  test('align rounds here up to CELL (idempotent)', () => {
    const m = new Memory()
    m.allot(5)
    m.align()
    expect(m.here).toBe(8)
    m.align()
    expect(m.here).toBe(8)
  })

  test('out-of-range access → THROW -9', () => {
    const m = new Memory(64)
    let code = 0
    try {
      m.cellAt(64)
    } catch (error) {
      code = (error as ForthThrow).code
    }
    expect(code).toBe(-9)
    expect(() => m.byteAt(-1)).toThrow(ForthThrow)
  })
})
