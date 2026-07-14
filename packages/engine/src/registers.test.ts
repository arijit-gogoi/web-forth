import { expect, test } from 'vitest'
import { makeRegisters, STATE_INTERPRET } from './registers'

test('register defaults', () => {
  const r = makeRegisters()
  expect(r.state).toBe(STATE_INTERPRET)
  expect(r.base).toBe(10)
  expect(r.running).toBe(false)
  expect(r.ip).toBe(0)
  expect(r.dsp).toBe(0)
  expect(r.rsp).toBe(0)
  expect(r.toIn).toBe(0)
  expect(r.source).toBe('')
})

test('makeRegisters returns a fresh object each call', () => {
  const a = makeRegisters()
  const b = makeRegisters()
  a.base = 16
  expect(b.base).toBe(10)
})
