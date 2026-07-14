// @web-forth/engine — the compiler's primitives: the compile-support RUNTIME words
// (lit/branch/?branch/(do)/(loop)/(+loop)/(?do)/(s")/(.")), the defining/state words
// (: ; [ ] immediate literal ' [']), and the control-flow IMMEDIATES (if..then,
// begin..until/again, begin..while..repeat, do/?do..loop/+loop) plus the comment
// words. Split out of forth.ts; installPrimitives() calls these three in the original
// definition order between installCore() and installDataDefining().
//
// The runtimes are compiled into threads by the immediates (their xts are captured on
// f as *Xt). The immediates are compile-only (§V.15); their backpatch targets are
// absolute addresses kept on the data stack during compilation.

import { ForthFault, ForthThrow, THROW_COMPILE_ONLY, THROW_UNDEFINED_WORD } from '../errors'
import { CELL } from '../memory'
import { STATE_COMPILE, STATE_INTERPRET } from '../registers'
import type { Forth } from '../forth'
import { makeDef } from './shared'

// Round a byte address up to the next CELL boundary. Used by the (s")/(.")
// runtimes to skip an inline [count][bytes] payload to the next aligned xt (§V.20).
const alignUp = (addr: number): number => {
  const rem = addr & (CELL - 1)
  return rem === 0 ? addr : addr + (CELL - rem)
}

// --- Compile-support runtime words (compiled into threads by the immediates) ---
// installRuntimes is the orchestrator; the sub-fns are split only to keep each under
// the unit-size threshold and must stay called in this exact order (byte-identical
// dictionary; the *Xt captures depend on it).
export const installRuntimes = (f: Forth): void => {
  installLiteralBranchRuntimes(f)
  installLoopRuntimes(f)
  installStringRuntimes(f)
}

const installLiteralBranchRuntimes = (f: Forth): void => {
  const def = makeDef(f)

  // lit: push the next inline cell and step ip past it.
  f.litXt = def('lit', (v) => {
    v.dstack.push(v.mem.cellAt(v.regs.ip))
    v.regs.ip += CELL
  })
  // branch: unconditional jump; target is the next inline cell (absolute address).
  f.branchXt = def('branch', (v) => {
    v.regs.ip = v.mem.cellAt(v.regs.ip)
  })
  // ?branch: pop a flag; branch if zero (false), else skip the target cell.
  f.qbranchXt = def('?branch', (v) => {
    const flag = v.dstack.pop()
    if (flag === 0) {
      v.regs.ip = v.mem.cellAt(v.regs.ip)
    } else {
      v.regs.ip += CELL
    }
  })
}

const installLoopRuntimes = (f: Forth): void => {
  const def = makeDef(f)

  // (do): runtime of DO. ( limit index -- ) push both onto the return stack.
  f.doXt = def('(do)', (v) => {
    const index = v.dstack.pop()
    const limit = v.dstack.pop()
    v.rstack.push(limit)
    v.rstack.push(index)
  })
  // (loop): runtime of LOOP. Increment index; if index < limit, branch back to the
  // loop top (next inline cell); else drop the loop control and continue.
  f.loopXt = def('(loop)', (v) => {
    const index = v.rstack.pop() + 1
    const limit = v.rstack.pop()
    if (index < limit) {
      v.rstack.push(limit)
      v.rstack.push(index)
      v.regs.ip = v.mem.cellAt(v.regs.ip) // branch to loop top
    } else {
      v.regs.ip += CELL // skip the loop-top target, exit the loop
    }
  })
  // (+loop): runtime of +LOOP ( n -- ). Add n to the index; loop again unless the
  // step crossed the limit boundary (§V.22). Boundary crossing = the sign of
  // (index-limit) flips between before and after; this handles negative steps that
  // plain (loop)'s index<limit cannot. gforth's test: ((old-limit) XOR (new-limit)) < 0.
  f.plusLoopXt = def('(+loop)', (v) => {
    const step = v.dstack.pop()
    const index = v.rstack.pop()
    const limit = v.rstack.pop()
    const next = (index + step) | 0
    const crossed = ((index - limit) ^ (next - limit)) < 0
    if (!crossed) {
      v.rstack.push(limit)
      v.rstack.push(next)
      v.regs.ip = v.mem.cellAt(v.regs.ip) // branch to loop top
    } else {
      v.regs.ip += CELL // exit the loop
    }
  })
  // (?do): runtime of ?DO ( limit index -- ). Like (do), but if limit==index the
  // loop body is empty, so jump past it to the resolved skip target (§V.22). The
  // skip target is the next inline cell (resolved by loop/+loop to just-after-loop).
  f.qDoXt = def('(?do)', (v) => {
    const index = v.dstack.pop()
    const limit = v.dstack.pop()
    if (limit === index) {
      v.regs.ip = v.mem.cellAt(v.regs.ip) // skip the (empty) loop entirely
    } else {
      v.rstack.push(limit)
      v.rstack.push(index)
      v.regs.ip += CELL // step past the skip-target cell into the body
    }
  })
  // (leave): runtime of LEAVE (§V.26). UNLOOP first — drop the loop control pair
  // [limit, index] off the return stack (index is on top, per (do)'s push order) —
  // THEN branch unconditionally to the just-past-loop target in the next inline cell
  // (loop/+loop patched it). Dropping the pair is load-bearing: the post-loop code
  // (and the §V.22 skip path) assumes the control pair is already gone, and a plain
  // branch that skipped this drop would leave the return stack dirty.
  f.leaveXt = def('(leave)', (v) => {
    v.rstack.pop() // index
    v.rstack.pop() // limit
    v.regs.ip = v.mem.cellAt(v.regs.ip) // branch past the loop
  })
}

const installStringRuntimes = (f: Forth): void => {
  const def = makeDef(f)

  // (s"): runtime of a compiled s" (§V.20). On entry ip points at the inline count
  // byte, followed by that many string bytes, then padding to the next CELL. Push
  // ( c-addr u ) and advance ip past the cell-aligned byte payload (the compiler
  // aligned it, so the next xt reads cleanly, precedent: lit). c-addr = ip+1.
  f.sQuoteXt = def('(s")', (v) => {
    const count = v.mem.byteAt(v.regs.ip)
    v.dstack.push(v.regs.ip + 1) // c-addr: first string byte
    v.dstack.push(count) // u: length
    v.regs.ip = alignUp(v.regs.ip + 1 + count) // skip [count][bytes] to next CELL
  })
  // (."): runtime of a compiled ." (§V.20). Same inline [count][bytes] layout as
  // (s"), but TYPE the bytes instead of pushing the span, then advance ip past the
  // cell-aligned payload.
  f.dotQuoteXt = def('(.")', (v) => {
    const count = v.mem.byteAt(v.regs.ip)
    let s = ''
    for (let i = 0; i < count; i++) s += String.fromCharCode(v.mem.byteAt(v.regs.ip + 1 + i))
    f.emit(s)
    v.regs.ip = alignUp(v.regs.ip + 1 + count)
  })
}

// --- Defining + state words ---
// installDefiningState is the orchestrator; the sub-fns are split only to keep each
// under the unit-size threshold and must stay called in this exact order (byte-
// identical dictionary).
export const installDefiningState = (f: Forth): void => {
  installColonState(f)
  installTickLiteral(f)
}

const installColonState = (f: Forth): void => {
  const def = makeDef(f)

  // : ( "name" -- ) create a colon header (CFA=DOCOL), smudge it, enter compile.
  def(':', () => {
    const name = f.parseName()
    if (name === null) throw new ForthThrow(THROW_UNDEFINED_WORD, ':')
    const cfa = f.dict.header(name)
    f.mem.setCell(cfa, f.docolIndex)
    f.dict.setHidden(f.regs.latest, true) // hide until ; (§V.11)
    f.regs.state = STATE_COMPILE
  })
  // ; (immediate, compile-only) compile EXIT, reveal the word, leave compile.
  def(
    ';',
    () => {
      f.compileOnly() // §V.15
      f.comma(f.exitXt)
      f.dict.setHidden(f.regs.latest, false)
      f.regs.state = STATE_INTERPRET
    },
    true,
  )
  // [ (immediate) leave compile; ] enter compile.
  def(
    '[',
    () => {
      f.regs.state = STATE_INTERPRET
    },
    true,
  )
  def(']', () => {
    f.regs.state = STATE_COMPILE
  })
  // immediate: mark the latest word immediate.
  def('immediate', () => {
    f.dict.setImmediate(f.regs.latest, true)
  })
  // recurse (immediate, compile-only) ( -- ) : compile a call to the definition in
  // progress (§V.25). The word being compiled is the smudged LATEST, hidden from
  // FIND until ; reveals it (§V.11), so its name cannot resolve mid-definition;
  // recurse reaches it directly by its CFA (cfaOf(latest)) instead. Not a runtime
  // word: it appends latest's xt into the current thread, exactly as the outer
  // interpreter would compile any non-immediate word.
  def(
    'recurse',
    () => {
      f.compileOnly() // §V.15
      f.comma(f.dict.cfaOf(f.regs.latest))
    },
    true,
  )
}

const installTickLiteral = (f: Forth): void => {
  const d = f.dstack
  const def = makeDef(f)

  // literal (immediate, compile-only) ( n -- ) : compile n as an inline literal.
  def(
    'literal',
    () => {
      f.compileOnly()
      f.comma(f.litXt)
      f.comma(d.pop())
    },
    true,
  )
  // ' ( "name" -- xt ) : push the xt of the next word (interpret-time tick).
  def("'", () => {
    const name = f.parseName()
    if (name === null) throw new ForthThrow(THROW_UNDEFINED_WORD, "'")
    const found = f.dict.find(name)
    if (found === null) throw new ForthThrow(THROW_UNDEFINED_WORD, name)
    d.push(found.xt)
  })
  // ['] (immediate, compile-only) ( "name" -- ) : compile the next word's xt as a literal.
  def(
    "[']",
    () => {
      f.compileOnly()
      const name = f.parseName()
      if (name === null) throw new ForthThrow(THROW_UNDEFINED_WORD, "[']")
      const found = f.dict.find(name)
      if (found === null) throw new ForthThrow(THROW_UNDEFINED_WORD, name)
      f.comma(f.litXt)
      f.comma(found.xt)
    },
    true,
  )
}

// --- Control-flow immediates (compile-only; §V.15). Backpatch targets are
// absolute addresses, kept on the data stack during compilation. installControlFlow
// is the orchestrator; the sub-fns are split only to keep each under the unit-size
// threshold and must stay called in this exact order (byte-identical dictionary). ---
export const installControlFlow = (f: Forth): void => {
  installConditionals(f)
  installBeginLoops(f)
  installDoLoops(f)
  installCase(f)
  installComments(f)
}

// The xt of an already-installed core word, for an immediate that compiles a call to
// it. Core is installed before the control-flow immediates, so these never miss; a
// null would be a build defect, so it faults loudly rather than compiling garbage.
const coreXt = (f: Forth, name: string): number => {
  const found = f.dict.find(name)
  if (found === null) throw new ForthFault(`case: core word '${name}' missing at install`)
  return found.xt
}

const installConditionals = (f: Forth): void => {
  const d = f.dstack
  const def = makeDef(f)

  // if: compile ?branch + a placeholder target; push the placeholder's address.
  def(
    'if',
    () => {
      f.compileOnly()
      f.comma(f.qbranchXt)
      d.push(f.comma(0)) // reserve target cell; leave its addr for then/else
    },
    true,
  )
  // else: compile branch + placeholder; resolve if's target to here; push new addr.
  def(
    'else',
    () => {
      f.compileOnly()
      f.comma(f.branchXt)
      const elseSlot = f.comma(0)
      const ifSlot = d.pop()
      f.mem.setCell(ifSlot, f.mem.here) // if jumps here when false
      d.push(elseSlot)
    },
    true,
  )
  // then: resolve the pending target (if or else) to here.
  def(
    'then',
    () => {
      f.compileOnly()
      const slot = d.pop()
      f.mem.setCell(slot, f.mem.here)
    },
    true,
  )
}

const installBeginLoops = (f: Forth): void => {
  const d = f.dstack
  const def = makeDef(f)

  // begin: push here (loop top) for until/again.
  def(
    'begin',
    () => {
      f.compileOnly()
      d.push(f.mem.here)
    },
    true,
  )
  // until: compile ?branch back to the begin target (loops while flag is false).
  def(
    'until',
    () => {
      f.compileOnly()
      f.comma(f.qbranchXt)
      f.comma(d.pop())
    },
    true,
  )
  // again: compile an unconditional branch back to begin (infinite loop).
  def(
    'again',
    () => {
      f.compileOnly()
      f.comma(f.branchXt)
      f.comma(d.pop())
    },
    true,
  )
  // while ( -- ) (compile-only) : inside begin ... while ... repeat. Compile
  // ?branch + a forward exit target; push its slot ABOVE the begin address so
  // repeat can resolve it. Stack: [beginAddr] -> [beginAddr, whileSlot].
  def(
    'while',
    () => {
      f.compileOnly()
      f.comma(f.qbranchXt)
      const beginAddr = d.pop()
      const whileSlot = f.comma(0)
      d.push(beginAddr)
      d.push(whileSlot)
    },
    true,
  )
  // repeat ( -- ) (compile-only) : branch back to begin, then resolve while's
  // forward exit to here (loop exit). Stack: [beginAddr, whileSlot] -> [].
  def(
    'repeat',
    () => {
      f.compileOnly()
      const whileSlot = d.pop()
      f.comma(f.branchXt)
      f.comma(d.pop()) // branch target = beginAddr
      f.mem.setCell(whileSlot, f.mem.here) // while exits here when flag is false
    },
    true,
  )
}

const installDoLoops = (f: Forth): void => {
  const d = f.dstack
  const def = makeDef(f)

  // Loop compile-stack convention (§V.22): every DO-class opener leaves TWO cells
  // for the closer: [skipSlot, loopTop]. skipSlot is the forward-branch target that
  // ?do resolves to just-past-the-loop; plain do uses the 0 sentinel (nothing to
  // resolve). loop/+loop pop loopTop, compile the runtime + loop-top target, then
  // resolve skipSlot if non-zero. This keeps one closer path for do and ?do.
  // do: compile (do); no skip slot (sentinel 0); push loop top; open a leave-list.
  def(
    'do',
    () => {
      f.compileOnly()
      f.comma(f.doXt)
      d.push(0) // skipSlot sentinel: plain do has no forward target
      d.push(f.mem.here) // loop top
      f.leaveLists.push([]) // §V.26: collect this loop's leave targets
    },
    true,
  )
  // ?do: compile (?do) + a forward skip-target cell; push [skipSlot, loopTop]; open
  // a leave-list.
  def(
    '?do',
    () => {
      f.compileOnly()
      f.comma(f.qDoXt)
      d.push(f.comma(0)) // skipSlot: (?do) reads it; loop resolves it past the loop
      d.push(f.mem.here) // loop top
      f.leaveLists.push([]) // §V.26
    },
    true,
  )
  // leave (immediate, compile-only, §V.26): compile (leave) + a placeholder target
  // cell, and record that cell in the innermost open loop's leave-list so loop/+loop
  // patches it to just-past-the-loop. A do/?do must be open (a leave-list on top);
  // outside one it is a stray leave -> THROW -14 (compile-only, and there is nothing
  // to leave). Note: leave resolves to the SAME address the ?do skipSlot resolves to,
  // but by a different mechanism (per-cell patch here vs the single skipSlot cell).
  def(
    'leave',
    () => {
      f.compileOnly()
      const list = f.leaveLists[f.leaveLists.length - 1]
      if (list === undefined) throw new ForthThrow(THROW_COMPILE_ONLY, 'leave outside a loop')
      f.comma(f.leaveXt)
      list.push(f.comma(0)) // placeholder; loop/+loop patches it to just-past-loop
    },
    true,
  )
  // loop: compile (loop) + loop-top target; resolve the ?do skip slot AND every
  // leave target to here (just-past-loop). skipSlot and the leave-list resolve to the
  // same HERE but stay separate (§V.26).
  def(
    'loop',
    () => {
      f.compileOnly()
      const loopTop = d.pop()
      f.comma(f.loopXt)
      f.comma(loopTop)
      resolveLoopExits(f, d.pop())
    },
    true,
  )
  // +loop: like loop but compiles (+loop) (signed step, boundary-crossing exit).
  def(
    '+loop',
    () => {
      f.compileOnly()
      const loopTop = d.pop()
      f.comma(f.plusLoopXt)
      f.comma(loopTop)
      resolveLoopExits(f, d.pop())
    },
    true,
  )
}

// Shared close-out for loop/+loop (§V.22, §V.26): resolve the ?do forward skip slot
// (0 sentinel for plain do) and pop this loop's leave-list, patching every recorded
// leave target — all to HERE, the just-past-loop address.
const resolveLoopExits = (f: Forth, skipSlot: number): void => {
  if (skipSlot !== 0) f.mem.setCell(skipSlot, f.mem.here)
  const list = f.leaveLists.pop()
  if (list !== undefined) {
    for (const cell of list) f.mem.setCell(cell, f.mem.here)
  }
}

// --- case / of / endof / endcase (Standard, §V.27). Compile-time immediates that
// backpatch through the data stack (of's next-clause branch) plus a JS-side exit-list
// (endof's past-endcase branches). Each path drops the selector exactly once: a
// matched clause drops it in `of`, the fall-through drops it in `endcase`. ---
const installCase = (f: Forth): void => {
  const d = f.dstack
  const def = makeDef(f)

  // case (immediate, compile-only) : no code; open an exit-list for the endofs.
  def(
    'case',
    () => {
      f.compileOnly()
      f.caseExits.push([]) // §V.27: collect this case's endof exit branches
    },
    true,
  )
  // of (immediate, compile-only) ( -- of-slot ) : compile `over = ?branch F drop` —
  // test the selector against the of-value WITHOUT consuming it (over), and on a
  // mismatch branch past this clause (F, resolved by endof to the next test). The
  // `drop` on the match path consumes the selector before the clause body runs
  // (§V.27); omit it and the body would see the selector still underneath. Push F.
  def(
    'of',
    () => {
      f.compileOnly()
      f.comma(coreXt(f, 'over'))
      f.comma(coreXt(f, '='))
      f.comma(f.qbranchXt)
      const ofSlot = f.comma(0) // mismatch jumps here-resolved-to-next-test
      f.comma(coreXt(f, 'drop')) // match path: drop the selector
      d.push(ofSlot)
    },
    true,
  )
  // endof (immediate, compile-only) ( of-slot -- ) : end a clause body. Compile an
  // unconditional branch past endcase (E, recorded for endcase to resolve), then
  // resolve this clause's of-slot to here so a mismatch lands on the NEXT of-test.
  def(
    'endof',
    () => {
      f.compileOnly()
      f.comma(f.branchXt)
      const exit = f.comma(0)
      const list = f.caseExits[f.caseExits.length - 1]
      if (list === undefined) throw new ForthThrow(THROW_COMPILE_ONLY, 'endof outside case')
      list.push(exit)
      f.mem.setCell(d.pop(), f.mem.here) // of's mismatch branch -> next test
    },
    true,
  )
  // endcase (immediate, compile-only) : close the case. Compile `drop` FIRST — the
  // fall-through path (no clause matched) still has the selector on the stack — THEN
  // resolve every endof exit to just after that drop (§V.27). Order is load-bearing:
  // resolving before the drop would route matched clauses (which already dropped in
  // `of`) through this drop too, double-dropping. Exactly one selector drop per path.
  def(
    'endcase',
    () => {
      f.compileOnly()
      const list = f.caseExits.pop()
      if (list === undefined) throw new ForthThrow(THROW_COMPILE_ONLY, 'endcase without case')
      f.comma(coreXt(f, 'drop')) // fall-through: drop the unmatched selector
      for (const exit of list) f.mem.setCell(exit, f.mem.here) // endofs land past the drop
    },
    true,
  )
}

const installComments = (f: Forth): void => {
  const def = makeDef(f)

  // --- Comments (Core-required: the prelude needs them readable, §02) ---
  // ( ... ) immediate: parse to the closing paren, discard.
  def(
    '(',
    () => {
      f.parse(')')
    },
    true,
  )
  // \ immediate: skip to end of line.
  def(
    '\\',
    () => {
      f.parse('\n')
    },
    true,
  )
}
