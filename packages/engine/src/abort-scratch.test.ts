// Regression: abort() must clear the JS-side compile scratch (§V.10, §B.2). The
// leave-list (§V.26) and case-exit-list (§V.27) stacks live on the Forth instance,
// NOT on the data stack, so unlike the [skipSlot,loopTop] data-stack scratch they do
// not self-heal when abort() sets dsp=0. A THROW mid-definition would otherwise leave
// a stale list behind, defeating the endof/endcase/leave "no open construct" guards on
// the NEXT definition. Same class as §B.1 (abort must fully reset compile state).

import { describe, expect, test } from 'vitest'
import { Forth } from './forth'

describe('abort clears leave/case scratch (§V.10, §B.2)', () => {
  test('a stale case-exit list does not survive an aborted compile', () => {
    const f = new Forth()
    // zzz is undefined -> THROW -13 mid case-compile -> abort(). caseExits must be
    // cleared, or the next endcase pops the stale list and skips its guard.
    f.interpret(': bad case 1 of 2 endof zzz')
    // Fresh definition with a bare endcase: with no open case, this must THROW -14.
    expect(f.interpret(': evil endcase ;').throwCode).toBe(-14)
  })

  test('a stale leave-list does not survive an aborted compile', () => {
    const f = new Forth()
    f.interpret(': bad2 5 0 do 1 leave zzz') // abort mid do-compile
    // loop with no open do would pop a stale leave-list and patch a dead cell; after a
    // clean abort the leaveLists stack is empty. A bare loop underflows the data stack
    // (no loopTop) -> a throw, definitely not a silent success.
    expect(f.interpret(': evil2 loop ;').throwCode).not.toBeNull()
  })

  test('the VM still compiles correctly after an aborted case-compile', () => {
    const f = new Forth()
    f.interpret(': bad case 1 of 2 endof zzz') // abort
    // A well-formed case now compiles and runs cleanly (no stale state interfering).
    f.interpret(': ok case 1 of 111 endof endcase ;')
    expect(f.interpret('1 ok').stack).toEqual([111])
  })

  test('leave still works after an aborted loop-compile', () => {
    const f = new Forth()
    f.interpret(': bad2 5 0 do 1 leave zzz') // abort
    f.interpret(': ok2 5 0 do i i 2 = if leave then loop ;')
    expect(f.interpret('ok2').stack).toEqual([0, 1, 2])
  })
})
