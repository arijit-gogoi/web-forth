import { describe, expect, test } from 'vitest'
import { Forth } from './forth'

describe('outer interpreter', () => {
  // §V.8 tokens execute in order; classic easyforth golden case.
  test('4 5 + . -> "9 " and empty stack', () => {
    const f = new Forth()
    const r = f.interpret('4 5 + .')
    expect(r.output).toBe('9 ')
    expect(r.throwCode).toBeNull()
    expect(r.stack).toEqual([])
  })

  test('numbers push in order; stack snapshot is bottom-to-top', () => {
    const f = new Forth()
    const r = f.interpret('1 2 3')
    expect(r.stack).toEqual([1, 2, 3])
    expect(r.throwCode).toBeNull()
  })

  test('. prints in order across the buffer', () => {
    const f = new Forth()
    const r = f.interpret('1 . 2 . 3 .')
    expect(r.output).toBe('1 2 3 ')
  })

  test('over/rot compose through the interpreter', () => {
    const f = new Forth()
    expect(f.interpret('1 2 over').stack).toEqual([1, 2, 1])
    const g = new Forth()
    expect(g.interpret('1 2 3 rot').stack).toEqual([2, 3, 1])
  })

  // §V.9 undefined word -> -13
  test('undefined word -> throwCode -13, does not throw out', () => {
    const f = new Forth()
    const r = f.interpret('4 foo')
    expect(r.throwCode).toBe(-13)
  })

  // §V.9 div-by-zero -> -10 rides the success channel
  test('division by zero -> throwCode -10', () => {
    const f = new Forth()
    const r = f.interpret('5 0 /')
    expect(r.throwCode).toBe(-10)
  })

  describe('number parsing', () => {
    test('signed decimal', () => {
      const f = new Forth()
      expect(f.interpret('-42 100 +').stack).toEqual([58])
    })

    test('$ hex prefix works in decimal base', () => {
      const f = new Forth()
      expect(f.interpret('$1F').stack).toEqual([31])
      const g = new Forth()
      expect(g.interpret('$ff $01 +').stack).toEqual([256])
    })

    test('negative hex via -$', () => {
      const f = new Forth()
      expect(f.interpret('-$10').stack).toEqual([-16])
    })

    test('HEX word switches the parsing base', () => {
      const f = new Forth()
      // hex sets base; 'ff' then parses as 255; '.' prints in hex
      const r = f.interpret('hex ff .')
      expect(r.stack).toEqual([])
      expect(r.output).toBe('ff ')
    })

    test('a non-number, non-word is undefined (-13), not silently zero', () => {
      const f = new Forth()
      expect(f.interpret('12x').throwCode).toBe(-13)
    })
  })

  describe('parseName / parse', () => {
    test('parseName skips runs of whitespace and stops at end', () => {
      const f = new Forth()
      f.regs.source = '  ab   cd  '
      f.regs.toIn = 0
      expect(f.parseName()).toBe('ab')
      expect(f.parseName()).toBe('cd')
      expect(f.parseName()).toBeNull()
    })

    test('parse collects to a delimiter and steps past it', () => {
      const f = new Forth()
      f.regs.source = 'hello) rest'
      f.regs.toIn = 0
      expect(f.parse(')')).toBe('hello')
      expect(f.regs.toIn).toBe(6) // just past ')'
    })
  })

  // §V.4 snapshot is a COPY, never the live buffer.
  test('stackSnapshot is a detached copy', () => {
    const f = new Forth()
    f.interpret('1 2 3')
    const snap = f.stackSnapshot()
    expect(snap).toEqual([1, 2, 3])
    f.dstack.pop() // mutate the live stack
    expect(snap).toEqual([1, 2, 3]) // snapshot unaffected
  })

  test('dictSnapshot lists installed words newest-first', () => {
    const f = new Forth()
    const snap = f.dictSnapshot()
    expect(snap.length).toBeGreaterThan(0)
    const names = snap.map((w) => w.name)
    expect(names).toContain('dup')
    expect(names).toContain('+')
    // every entry reports flags
    expect(snap.every((w) => typeof w.immediate === 'boolean')).toBe(true)
  })

  // §V.10 (stub form for §T.7): after an error the instance stays usable.
  test('interpreter recovers after an error (stacks cleared, reusable)', () => {
    const f = new Forth()
    const bad = f.interpret('1 2 foo')
    expect(bad.throwCode).toBe(-13)
    expect(f.regs.dsp).toBe(0) // data stack cleared
    expect(f.regs.rsp).toBe(0)
    const good = f.interpret('7 8 +')
    expect(good.stack).toEqual([15]) // fresh run works
    expect(good.throwCode).toBeNull()
  })

  test('reset returns the VM to a fresh boot state', () => {
    const f = new Forth()
    f.interpret('1 2 3 4 5')
    expect(f.regs.dsp).toBe(5)
    f.reset()
    expect(f.regs.dsp).toBe(0)
    expect(f.regs.base).toBe(10)
    // primitives still work after reset
    expect(f.interpret('2 3 *').stack).toEqual([6])
    // and the dictionary is intact
    expect(f.dict.find('dup')).not.toBeNull()
  })
})
