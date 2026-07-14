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

import { ForthThrow, THROW_UNDEFINED_WORD } from '../errors'
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
  installComments(f)
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
  // do: compile (do); no skip slot (sentinel 0); push loop top.
  def(
    'do',
    () => {
      f.compileOnly()
      f.comma(f.doXt)
      d.push(0) // skipSlot sentinel: plain do has no forward target
      d.push(f.mem.here) // loop top
    },
    true,
  )
  // ?do: compile (?do) + a forward skip-target cell; push [skipSlot, loopTop].
  def(
    '?do',
    () => {
      f.compileOnly()
      f.comma(f.qDoXt)
      d.push(f.comma(0)) // skipSlot: (?do) reads it; loop resolves it past the loop
      d.push(f.mem.here) // loop top
    },
    true,
  )
  // loop: compile (loop) + loop-top target; resolve the ?do skip slot to here.
  def(
    'loop',
    () => {
      f.compileOnly()
      const loopTop = d.pop()
      f.comma(f.loopXt)
      f.comma(loopTop)
      const skipSlot = d.pop()
      if (skipSlot !== 0) f.mem.setCell(skipSlot, f.mem.here)
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
      const skipSlot = d.pop()
      if (skipSlot !== 0) f.mem.setCell(skipSlot, f.mem.here)
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
