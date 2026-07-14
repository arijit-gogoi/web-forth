import { describe, expect, test } from 'vitest'
import { ForthThrow } from './errors'
import { Forth } from './forth'
import { HALT_XT } from './inner'
import { CELL } from './memory'

// Drive a primitive by name through the inner interpreter (the outer interpreter
// that parses text arrives in §T.7). Push args first, then run.
const run = (f: Forth, name: string): void => {
  const found = f.dict.find(name)
  if (!found) throw new Error(`primitive not found: ${name}`)
  f.execute(found.xt)
}

const push = (f: Forth, ...ns: Array<number>): void => {
  for (const n of ns) f.dstack.push(n)
}

describe('class Forth composition', () => {
  // advisor composition check: addr-0 survives installing every primitive.
  test('after installing primitives, cell(0) still dispatches to HALT', () => {
    const f = new Forth()
    expect(f.mem.cellAt(HALT_XT)).toBe(f.inner.haltIndex)
    expect(f.inner.haltIndex).toBe(0)
  })

  test('first and second primitive both resolve and align', () => {
    const f = new Forth()
    const dup = f.dict.find('dup')
    const drop = f.dict.find('drop')
    expect(dup).not.toBeNull()
    expect(drop).not.toBeNull()
    expect(dup!.xt % CELL).toBe(0)
    expect(drop!.xt % CELL).toBe(0)
    expect(dup!.xt).not.toBe(drop!.xt)
  })

  test('Dictionary is the sole owner of the boot cell (no double reserve)', () => {
    // If Inner also allotted, here would start at 2*CELL and a phantom cell would
    // sit at CELL. The first header link must land exactly at BOOT_RESERVED (CELL).
    const f = new Forth()
    // Walk to the oldest word (first link in the chain): its link field == CELL.
    let link = f.regs.latest
    let prev = f.mem.cellAt(link)
    while (prev !== 0) {
      link = prev
      prev = f.mem.cellAt(link)
    }
    expect(link).toBe(CELL) // first header sits right after the single boot cell
  })
})

describe('stack primitives', () => {
  test('dup swap over rot drop', () => {
    const f = new Forth()
    push(f, 1, 2)
    run(f, 'dup')
    expect([f.dstack.cells[0], f.dstack.cells[1], f.dstack.cells[2]]).toEqual([1, 2, 2])

    const g = new Forth()
    push(g, 1, 2)
    run(g, 'swap')
    expect(g.dstack.pop()).toBe(1)
    expect(g.dstack.pop()).toBe(2)

    const h = new Forth()
    push(h, 1, 2)
    run(h, 'over')
    expect(h.dstack.pop()).toBe(1) // a b -- a b a
    expect(h.dstack.pop()).toBe(2)
    expect(h.dstack.pop()).toBe(1)

    const k = new Forth()
    push(k, 1, 2, 3)
    run(k, 'rot')
    expect(k.dstack.pop()).toBe(1) // a b c -- b c a
    expect(k.dstack.pop()).toBe(3)
    expect(k.dstack.pop()).toBe(2)
  })
})

describe('arithmetic primitives', () => {
  test('+ - * / mod', () => {
    const f = new Forth()
    push(f, 4, 5)
    run(f, '+')
    expect(f.dstack.pop()).toBe(9)

    push(f, 10, 3)
    run(f, '-')
    expect(f.dstack.pop()).toBe(7)

    push(f, 6, 7)
    run(f, '*')
    expect(f.dstack.pop()).toBe(42)

    push(f, 17, 5)
    run(f, '/')
    expect(f.dstack.pop()).toBe(3) // truncated

    push(f, 17, 5)
    run(f, 'mod')
    expect(f.dstack.pop()).toBe(2)
  })

  test('/mod pushes remainder then quotient', () => {
    const f = new Forth()
    push(f, 17, 5)
    run(f, '/mod')
    expect(f.dstack.pop()).toBe(3) // quotient on top
    expect(f.dstack.pop()).toBe(2) // remainder below
  })

  test('* wraps at int32 (Math.imul)', () => {
    const f = new Forth()
    push(f, 0x10000, 0x10000) // 2^32 -> wraps to 0
    run(f, '*')
    expect(f.dstack.pop()).toBe(0)
  })

  // §V.9 div-by-zero -> -10
  test('division by zero throws -10', () => {
    for (const word of ['/', 'mod', '/mod']) {
      const f = new Forth()
      push(f, 5, 0)
      let code = 0
      try {
        run(f, word)
      } catch (e) {
        code = (e as ForthThrow).code
      }
      expect(code).toBe(-10)
    }
  })
})

describe('compare / logic primitives', () => {
  test('comparisons yield Forth flags (-1 true, 0 false)', () => {
    const cases: Array<[Array<number>, string, number]> = [
      [[3, 3], '=', -1],
      [[3, 4], '=', 0],
      [[3, 4], '<>', -1],
      [[3, 4], '<', -1],
      [[4, 3], '>', -1],
      [[0], '0=', -1],
      [[-5], '0<', -1],
      [[5], '0>', -1],
    ]
    for (const [args, word, expected] of cases) {
      const f = new Forth()
      push(f, ...args)
      run(f, word)
      expect(f.dstack.pop()).toBe(expected)
    }
  })

  test('and or xor invert are bitwise', () => {
    const f = new Forth()
    push(f, 0b1100, 0b1010)
    run(f, 'and')
    expect(f.dstack.pop()).toBe(0b1000)
    push(f, 0b1100, 0b1010)
    run(f, 'or')
    expect(f.dstack.pop()).toBe(0b1110)
    push(f, 0b1100, 0b1010)
    run(f, 'xor')
    expect(f.dstack.pop()).toBe(0b0110)
    push(f, 0)
    run(f, 'invert')
    expect(f.dstack.pop()).toBe(-1)
  })
})

describe('return-stack primitives', () => {
  test('>r r> round-trip; r@ copies', () => {
    const f = new Forth()
    push(f, 99)
    run(f, '>r')
    expect(f.regs.rsp).toBe(1)
    run(f, 'r@')
    expect(f.dstack.pop()).toBe(99)
    run(f, 'r>')
    expect(f.dstack.pop()).toBe(99)
    expect(f.regs.rsp).toBe(0)
  })
})

describe('memory primitives', () => {
  test('here , @ ! round-trip', () => {
    const f = new Forth()
    run(f, 'here')
    const addr = f.dstack.peek()
    push(f, 12345) // value to store
    run(f, ',') // consumes 12345, allots a cell at `here`, advances here
    push(f, addr)
    run(f, '@')
    expect(f.dstack.pop()).toBe(12345)
    // now `here` advanced by one CELL
    f.dstack.pop() // drop the earlier `here` addr
    run(f, 'here')
    expect(f.dstack.pop()).toBe(addr + CELL)
  })

  test('! then @; +! accumulates', () => {
    const f = new Forth()
    run(f, 'here')
    const addr = f.dstack.pop()
    push(f, 100, addr)
    run(f, '!')
    push(f, 5, addr)
    run(f, '+!')
    push(f, addr)
    run(f, '@')
    expect(f.dstack.pop()).toBe(105)
  })

  test('c! c@ byte access', () => {
    const f = new Forth()
    run(f, 'here')
    const addr = f.dstack.pop()
    push(f, 0xab, addr)
    run(f, 'c!')
    push(f, addr)
    run(f, 'c@')
    expect(f.dstack.pop()).toBe(0xab)
  })

  test('cells cell+ aligned', () => {
    const f = new Forth()
    push(f, 3)
    run(f, 'cells')
    expect(f.dstack.pop()).toBe(12)
    push(f, 100)
    run(f, 'cell+')
    expect(f.dstack.pop()).toBe(104)
    push(f, 5)
    run(f, 'aligned')
    expect(f.dstack.pop()).toBe(8)
  })
})

describe('io primitives', () => {
  test('. prints signed in base with trailing space', () => {
    const f = new Forth()
    push(f, 42)
    run(f, '.')
    expect(f.output).toBe('42 ')
  })

  test('u. prints unsigned', () => {
    const f = new Forth()
    push(f, -1)
    run(f, 'u.')
    expect(f.output).toBe('4294967295 ')
  })

  test('hex changes . formatting; decimal restores', () => {
    const f = new Forth()
    run(f, 'hex')
    push(f, 255)
    run(f, '.')
    expect(f.output).toBe('ff ')
    run(f, 'decimal')
    push(f, 255)
    run(f, '.')
    expect(f.output).toBe('ff 255 ')
  })

  test('emit cr space append to output', () => {
    const f = new Forth()
    push(f, 65) // 'A'
    run(f, 'emit')
    run(f, 'space')
    run(f, 'cr')
    expect(f.output).toBe('A \n')
  })

  test('.s prints depth and contents non-destructively', () => {
    const f = new Forth()
    push(f, 1, 2, 3)
    run(f, '.s')
    expect(f.output).toBe('<3> 1 2 3 ')
    expect(f.regs.dsp).toBe(3) // non-destructive
  })
})
