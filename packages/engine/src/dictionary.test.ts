import { describe, expect, test } from 'vitest'
import {
  BOOT_RESERVED,
  Dictionary,
  FLAG_HIDDEN,
  FLAG_IMMEDIATE,
  LENFLAGS_OFFSET,
  NAME_LEN_MASK,
  toBody,
} from './dictionary'
import { ForthThrow } from './errors'
import { CELL, Memory } from './memory'
import { makeRegisters } from './registers'

const makeDict = () => {
  const mem = new Memory()
  const regs = makeRegisters()
  return { mem, regs, dict: new Dictionary(mem, regs) }
}

describe('Dictionary', () => {
  // advisor constraint #1: address-0 sentinel must not collide
  test('empty dictionary find returns null without throwing; addr 0 is reserved', () => {
    const { mem, regs, dict } = makeDict()
    expect(regs.latest).toBe(0) // empty-chain sentinel
    expect(dict.find('anything')).toBeNull()
    expect(mem.here).toBe(BOOT_RESERVED) // boot cell reserved, dict starts past it
  })

  test('first defined word is findable (does not vanish at addr 0)', () => {
    const { regs, dict } = makeDict()
    const xt = dict.header('dup')
    expect(regs.latest).not.toBe(0) // link field is past the reserved boot cell
    const found = dict.find('dup')
    expect(found).not.toBeNull()
    expect(found?.xt).toBe(xt)
  })

  // advisor constraint #2: CFA cell-aligned for §T.5 cell(w) dispatch
  test('CFA is CELL-aligned for names of length 1..7 (feeds §V.6 dispatch)', () => {
    for (const name of ['a', 'ab', 'abc', 'abcd', 'abcde', 'abcdef', 'abcdefg']) {
      const { dict } = makeDict()
      const cfa = dict.header(name)
      expect(cfa % CELL).toBe(0)
    }
  })

  test('two back-to-back headers are both aligned and both findable', () => {
    const { dict } = makeDict()
    const a = dict.header('swap')
    const b = dict.header('over')
    expect(a % CELL).toBe(0)
    expect(b % CELL).toBe(0)
    expect(a).not.toBe(b)
    expect(dict.find('swap')?.xt).toBe(a)
    expect(dict.find('over')?.xt).toBe(b)
  })

  test('FIND is case-insensitive (traditional)', () => {
    const { dict } = makeDict()
    const xt = dict.header('DUP')
    expect(dict.find('dup')?.xt).toBe(xt)
    expect(dict.find('Dup')?.xt).toBe(xt)
    const xt2 = dict.header('emit')
    expect(dict.find('EMIT')?.xt).toBe(xt2)
  })

  test('newest definition shadows an older same-named word', () => {
    const { dict } = makeDict()
    dict.header('x')
    const newer = dict.header('x')
    expect(dict.find('x')?.xt).toBe(newer)
  })

  test('IMMEDIATE flag is reported by find and header()', () => {
    const { dict } = makeDict()
    dict.header('if', true)
    expect(dict.find('if')?.immediate).toBe(true)
    dict.header('dup')
    expect(dict.find('dup')?.immediate).toBe(false)
  })

  // advisor constraint #3: FIND skips HIDDEN/smudged words
  test('hidden (smudged) word is not found; revealing makes it found', () => {
    const { regs, dict } = makeDict()
    dict.header('half')
    const link = regs.latest
    dict.setHidden(link, true)
    expect(dict.isHidden(link)).toBe(true)
    expect(dict.find('half')).toBeNull() // smudged -> invisible
    dict.setHidden(link, false)
    expect(dict.find('half')).not.toBeNull() // revealed
  })

  test('setImmediate toggles the flag in place', () => {
    const { regs, dict } = makeDict()
    dict.header('post')
    const link = regs.latest
    expect(dict.isImmediate(link)).toBe(false)
    dict.setImmediate(link, true)
    expect(dict.isImmediate(link)).toBe(true)
    expect(dict.find('post')?.immediate).toBe(true)
  })

  // advisor constraint #4: name length capped at 63
  test('name longer than 63 bytes is rejected', () => {
    const { dict } = makeDict()
    const long = 'a'.repeat(NAME_LEN_MASK + 1)
    expect(() => dict.header(long)).toThrow(ForthThrow)
    // exactly 63 is accepted
    expect(() => dict.header('b'.repeat(NAME_LEN_MASK))).not.toThrow()
  })

  test('empty name is rejected', () => {
    const { dict } = makeDict()
    expect(() => dict.header('')).toThrow(ForthThrow)
  })

  test('lenflags byte packs immediate bit + length', () => {
    const { mem, regs, dict } = makeDict()
    dict.header('abc', true)
    const lenflags = mem.byteAt(regs.latest + LENFLAGS_OFFSET)
    expect(lenflags & NAME_LEN_MASK).toBe(3)
    expect((lenflags & FLAG_IMMEDIATE) !== 0).toBe(true)
    expect((lenflags & FLAG_HIDDEN) !== 0).toBe(false)
  })

  // §V.11: >BODY arithmetic for CREATE-class 2-slot code field
  test('toBody returns CFA + 2*CELL (§V.11 CREATE layout)', () => {
    expect(toBody(100)).toBe(100 + 2 * CELL)
    expect(toBody(0)).toBe(8)
  })
})
