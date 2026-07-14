import { describe, expect, test } from 'vitest'
import { ForthFault } from './errors'
import { Forth } from './forth'
import { CELL } from './memory'
import { messageFor, THROW_ABORT } from './messages'

describe('THROW-code messages (gforth-style)', () => {
  test('known codes map to informative text ending in newline', () => {
    expect(messageFor(-4)).toBe('Stack underflow\n')
    expect(messageFor(-10)).toBe('Division by zero\n')
    expect(messageFor(THROW_ABORT)).toBe('Aborted\n')
  })

  test('undefined word carries the offending token', () => {
    expect(messageFor(-13, 'foo')).toBe('Undefined word: foo\n')
  })

  test('unknown / user code reports the number', () => {
    expect(messageFor(42)).toBe('Error 42\n')
    expect(messageFor(-999)).toBe('Error -999\n')
  })
})

describe('interpreter prints messages then continues (§V.10)', () => {
  test('undefined word prints "Undefined word: <tok>"', () => {
    const f = new Forth()
    const r = f.interpret('1 2 zzz')
    expect(r.throwCode).toBe(-13)
    expect(r.output).toContain('Undefined word: zzz')
  })

  test('stack underflow prints "Stack underflow"', () => {
    const f = new Forth()
    const r = f.interpret('drop') // empty stack
    expect(r.throwCode).toBe(-4)
    expect(r.output).toContain('Stack underflow')
  })

  test('division by zero prints "Division by zero"', () => {
    const f = new Forth()
    const r = f.interpret('1 0 /')
    expect(r.output).toContain('Division by zero')
  })

  test('rest of the buffer after an error is NOT processed (ABORT stops it)', () => {
    const f = new Forth()
    const r = f.interpret('999 zzz . . .') // zzz aborts before the dots run
    expect(r.throwCode).toBe(-13)
    // the '.' words never ran, so no trailing numbers were printed
    expect(r.output).not.toContain('999')
  })
})

describe('throw / abort words (§V.9)', () => {
  test('throw with a non-zero code rides the success channel', () => {
    const f = new Forth()
    const r = f.interpret('7 throw')
    expect(r.throwCode).toBe(7)
    expect(r.output).toContain('Error 7')
  })

  test('throw 0 is a no-op', () => {
    const f = new Forth()
    const r = f.interpret('0 throw 5')
    expect(r.throwCode).toBeNull()
    expect(r.stack).toEqual([5])
  })

  test('abort throws -1 and clears the stack', () => {
    const f = new Forth()
    const r = f.interpret('1 2 3 abort')
    expect(r.throwCode).toBe(-1)
    expect(r.stack).toEqual([]) // data stack cleared
    expect(r.output).toContain('Aborted')
  })
})

describe('ABORT clears both stacks (§V.10, §B.1)', () => {
  // A colon word that enters (DOCOL pushes a return addr, rsp=1) then throws mid-body
  // before any EXIT runs. The ForthThrow unwinds the JS stack without executing the
  // pending EXIT, so rsp would stay dirty unless abort() resets it.
  test('throw deep in a nested colon leaves rsp AND dsp clean; instance reusable', () => {
    const f = new Forth()

    // Hand-assemble a colon word: [DOCOL][ABORT_xt]. Entering it pushes the return
    // address (rsp -> 1); ABORT then throws -1 before EXIT.
    const abortXt = f.dict.find('abort')!.xt
    const cfa = f.dict.header('boom')
    f.mem.setCell(cfa, f.docolIndex) // [DOCOL]
    const body = f.mem.allot(CELL)
    f.mem.setCell(body, abortXt) // body: call abort

    const r = f.interpret('boom')
    expect(r.throwCode).toBe(-1)
    expect(f.regs.rsp).toBe(0) // return stack reset despite the mid-colon unwind
    expect(f.regs.dsp).toBe(0)

    // The instance still works after the deep abort.
    const again = f.interpret('4 5 +')
    expect(again.stack).toEqual([9])
    expect(again.throwCode).toBeNull()
  })
})

describe('ForthFault escapes as an exception (§V.5)', () => {
  // Genuine VM faults are NOT Forth errors: they must propagate out of interpret()
  // as a JS exception (to the Effect E-channel), not ride the success channel.
  test('a ForthFault raised by a word propagates out of interpret()', () => {
    const f = new Forth()
    // Register a primitive that raises a ForthFault, then a header for it.
    const idx = f.inner.addRoutine(() => {
      throw new ForthFault('corrupt VM state')
    })
    const cfa = f.dict.header('faulty')
    f.mem.setCell(cfa, idx)

    expect(() => f.interpret('faulty')).toThrow(ForthFault)
  })

  test('a ForthThrow (Forth error) does NOT propagate, but a ForthFault does', () => {
    const f = new Forth()
    // Forth error: caught, returned as data.
    expect(() => f.interpret('zzz')).not.toThrow()
  })
})
