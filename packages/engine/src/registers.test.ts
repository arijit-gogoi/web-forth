import { expect, test } from 'vitest'
import { makeRegisters, STATE_INTERPRET } from './registers'

test('register defaults', () => {
  const r = makeRegisters()
  expect(r.state).toBe(STATE_INTERPRET)
  expect(r.running).toBe(false)
  expect(r.ip).toBe(0)
  expect(r.dsp).toBe(0)
  expect(r.rsp).toBe(0)
  expect(r.toIn).toBe(0)
  expect(r.source).toBe('')
  // BASE is not a register (it is a memory cell); see Forth.baseAddr.
})

test('makeRegisters returns a fresh object each call', () => {
  const a = makeRegisters()
  const b = makeRegisters()
  a.dsp = 5
  expect(b.dsp).toBe(0)
})
