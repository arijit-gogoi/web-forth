// §T.13 channel tests (§V.5, §V.2): prove the Vm seam maps the two error kinds to the
// right Effect channels. A Forth error rides the SUCCESS channel as data (RunResult with
// a non-null throwCode); an injected ForthFault rides the E-channel (Effect.fail).

import { Effect, Exit, Semaphore } from 'effect'
import { it } from '@effect/vitest'
import { describe, expect } from 'vitest'
import { Forth, ForthFault } from '@web-forth/engine'
import { makeVm } from './vm'

// A permit-1 semaphore, built unsafely for synchronous test construction.
const sem = () => Semaphore.makeUnsafe(1)

describe('Vm channel mapping (§V.5)', () => {
  it.effect('a valid run succeeds with output + stack', () =>
    Effect.gen(function* () {
      const vm = makeVm(sem())
      const result = yield* vm.interpret('1 2 + .')
      expect(result.output).toBe('3 ')
      expect(result.throwCode).toBeNull()
      expect(result.stack).toEqual([])
    }),
  )

  it.effect('a Forth error rides the SUCCESS channel as data, not the E-channel', () =>
    Effect.gen(function* () {
      const vm = makeVm(sem())
      // undefined word -> throwCode -13, but the Effect SUCCEEDS (error is data).
      const result = yield* vm.interpret('bogus-word')
      expect(result.throwCode).toBe(-13)
      expect(typeof result.output).toBe('string')
      expect(result.output.toLowerCase()).toContain('bogus-word')
    }),
  )

  it.effect('stack underflow is also a success-channel RunResult', () =>
    Effect.gen(function* () {
      const vm = makeVm(sem())
      const result = yield* vm.interpret('drop')
      expect(result.throwCode).toBe(-4)
    }),
  )

  it.effect('an injected ForthFault rides the E-channel (Effect.fail)', () =>
    Effect.gen(function* () {
      // Build a Forth whose word "kaboom" throws a genuine VM fault.
      const forth = new Forth()
      const index = forth.inner.addRoutine(() => {
        throw new ForthFault('simulated corruption')
      })
      const cfa = forth.dict.header('kaboom')
      forth.mem.setCell(cfa, index)

      const vm = makeVm(sem(), forth)
      const exit = yield* Effect.exit(vm.interpret('kaboom'))
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect('the ForthFault is preserved as the typed failure value', () =>
    Effect.gen(function* () {
      const forth = new Forth()
      const index = forth.inner.addRoutine(() => {
        throw new ForthFault('boom')
      })
      forth.mem.setCell(forth.dict.header('kaboom'), index)

      const vm = makeVm(sem(), forth)
      // flip turns the E-channel into the success channel, so a clean yield hands us
      // the failure value to assert on.
      const fault = yield* Effect.flip(vm.interpret('kaboom'))
      expect(fault).toBeInstanceOf(ForthFault)
      expect(fault.message).toBe('boom')
    }),
  )
})

describe('Vm snapshots + reset (§I.svc)', () => {
  it.effect('stackSnapshot reflects the live stack after interpret', () =>
    Effect.gen(function* () {
      const vm = makeVm(sem())
      yield* vm.interpret('10 20 30')
      const snapshot = yield* vm.stackSnapshot
      expect(snapshot).toEqual([10, 20, 30])
    }),
  )

  it.effect('dictSnapshot lists installed words newest-first', () =>
    Effect.gen(function* () {
      const vm = makeVm(sem())
      yield* vm.interpret(': myword 1 ;')
      const snapshot = yield* vm.dictSnapshot
      expect(snapshot.length).toBeGreaterThan(0)
      expect(snapshot.some((word) => word.name === 'myword')).toBe(true)
    }),
  )

  it.effect('reset clears the stack and user words', () =>
    Effect.gen(function* () {
      const vm = makeVm(sem())
      yield* vm.interpret(': foo 1 ; 1 2 3')
      yield* vm.reset
      const snapshot = yield* vm.stackSnapshot
      expect(snapshot).toEqual([])
      const afterReset = yield* vm.interpret('2 2 +')
      expect(afterReset.stack).toEqual([4])
    }),
  )
})

// §V.13: the service serializes interpret. Structural check that concurrent interprets
// against the shared core still produce a coherent final state (no interleaving
// corruption of the single mutable Forth).
describe('Vm serializes interpret (§V.13)', () => {
  it.effect('concurrent interprets do not corrupt the shared core', () =>
    Effect.gen(function* () {
      const vm = makeVm(sem())
      // Fire several pushes concurrently; the semaphore forces them to run one at a
      // time, so the final depth is deterministic (3 values on the stack).
      yield* Effect.all(
        [vm.interpret('1'), vm.interpret('2'), vm.interpret('3')],
        { concurrency: 'unbounded' },
      )
      const snapshot = yield* vm.stackSnapshot
      expect(snapshot.length).toBe(3)
    }),
  )
})
