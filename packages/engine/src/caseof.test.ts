// case / of / endof / endcase (SPEC §T.30, §V.27). A CASE selects one clause by
// matching a selector value. The discriminating property is the selector accounting:
// exactly ONE drop per path (the matched clause drops in `of`, the fall-through drops
// in `endcase`), so no path leaves the selector behind and none double-drops. The
// nested-case and default cases round out the structure.

import { describe, expect, test } from 'vitest'
import { Forth } from './forth'

describe('case selection (§V.27)', () => {
  test('a matching clause runs and consumes the selector', () => {
    const f = new Forth()
    // ANS default is empty (endcase drops the selector); a value-producing default
    // must account for the selector itself (e.g. `999 swap`, tested below).
    f.interpret(': t case 1 of 111 endof 2 of 222 endof endcase ;')
    expect(f.interpret('1 t').stack).toEqual([111]) // first clause; selector gone
    expect(f.interpret('drop 2 t').stack).toEqual([222]) // second clause
  })

  test('no match: the fall-through drop removes the selector (empty default)', () => {
    const f = new Forth()
    f.interpret(': t case 1 of 111 endof 2 of 222 endof endcase ;')
    // 5 matches nothing and the default is empty: endcase drop removes the 5.
    expect(f.interpret('5 t').stack).toEqual([])
    expect(f.interpret('5 t').throwCode).toBeNull()
  })

  test('a default runs observably (print) and endcase still drops the selector', () => {
    const f = new Forth()
    // ." other" runs on the fall-through WITHOUT touching the data stack, so endcase
    // cleanly drops the selector afterward. Proves the default clause executes.
    f.interpret(': t case 1 of ." one" endof 2 of ." two" endof ." other" endcase ;')
    const r = f.interpret('5 t')
    expect(r.output).toBe('other')
    expect(r.stack).toEqual([])
    expect(f.interpret('1 t').output).toBe('one') // matched clause prints instead
  })

  test('a value-producing default must account for the selector (ANS `swap`)', () => {
    const f = new Forth()
    // To leave a value on the fall-through, put it UNDER the selector (swap) so the
    // endcase drop still removes the selector, not the value.
    f.interpret(': t case 1 of 111 endof 2 of 222 endof 999 swap endcase ;')
    expect(f.interpret('5 t').stack).toEqual([999]) // default value survives
    expect(f.interpret('drop 1 t').stack).toEqual([111]) // matched path unaffected
  })

  test('a matched clause leaves only its body result (selector consumed once)', () => {
    const f = new Forth()
    f.interpret(': t case 10 of 1 endof 20 of 2 endof endcase ;')
    // 10 matches -> [1], selector consumed exactly once (no leftover 10 under it)
    expect(f.interpret('10 t').stack).toEqual([1])
  })
})

describe('case does not double-drop or under-drop (§V.27 exactly-one-drop)', () => {
  test('the selector accounting balances for every branch', () => {
    const f = new Forth()
    // Push a sentinel BELOW the selector; after t runs, the sentinel must still be
    // there and nothing else (proves the case consumed exactly the selector, never
    // the sentinel via a double-drop, never left the selector via an under-drop).
    f.interpret(': t case 1 of 100 endof 2 of 200 endof endcase ;')
    // matched path: [sentinel=7, 100]
    expect(f.interpret('7 1 t').stack).toEqual([7, 100])
    f.interpret('drop drop')
    // default path (empty): endcase drops the selector 9, leaving just the sentinel
    expect(f.interpret('7 9 t').stack).toEqual([7])
  })
})

describe('nested case (§V.27)', () => {
  test('an inner case selects independently (value-producing default via swap)', () => {
    const f = new Forth()
    // inner uses `0 swap` as its accounted default so it can return 0 on no-match.
    f.interpret(': inner case 1 of 11 endof 2 of 22 endof 0 swap endcase ;')
    expect(f.interpret('1 inner').stack).toEqual([11])
    expect(f.interpret('drop 2 inner').stack).toEqual([22])
    expect(f.interpret('drop 7 inner').stack).toEqual([0]) // default
  })

  test('a case nested inside an outer clause body compiles and runs', () => {
    const f = new Forth()
    // outer clause body contains a full inner case (empty inner default); exercise the
    // matched outer path.
    f.interpret(
      ': t case' +
        '   1 of  case 10 of 111 endof endcase  endof' +
        '   endcase ;',
    )
    // 10 (inner) 1 (outer): outer of consumes 1 -> body sees 10 -> inner matches -> 111
    expect(f.interpret('10 1 t').stack).toEqual([111])
    // 10 (inner) 5 (outer): outer no match, empty outer default -> outer drop removes
    // the 5; the inner 10 stays (never an outer selector), so stack is [10].
    expect(f.interpret('drop 10 5 t').stack).toEqual([10])
  })
})

describe('case compile-only guards (§V.15/§V.27)', () => {
  test('case of endof endcase each THROW -14 in interpret state', () => {
    for (const word of ['case', 'of', 'endof', 'endcase']) {
      const f = new Forth()
      expect(f.interpret(word).throwCode).toBe(-14)
    }
  })
})
