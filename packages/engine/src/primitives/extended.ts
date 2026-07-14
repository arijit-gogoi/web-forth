// @web-forth/engine — the Extended tail of the word-set: EVALUATE (§V.18), the
// string + char-literal words (§V.20, §V.23), the system words (bye/throw/abort),
// and CATCH (§V.17). Split out of forth.ts; installPrimitives() calls
// installExtended() after installDataDefining(), then installExit() last.
//
// CATCH and EVALUATE are the two sanctioned §V.1 nested-run carve-outs; the delicate
// register save/restore for CATCH lives here, EVALUATE's in forth.ts (it reuses the
// private runTokens()).

import { ForthThrow, THROW_UNDEFINED_WORD } from '../errors'
import { EXIT } from '../inner'
import { THROW_ABORT } from '../messages'
import type { Forth } from '../forth'
import { makeDef } from './shared'

export const installExtended = (f: Forth): void => {
  const d = f.dstack
  const def = makeDef(f)

  // evaluate ( c-addr u -- ) : interpret the counted string as Forth source via a
  // nested text-interpret (§V.18). Stack-transparent: results and definitions the
  // text produces persist; a throw propagates to the nearest catch / top level.
  def('evaluate', () => {
    const len = d.pop()
    const addr = d.pop()
    f.evaluate(addr, len)
  })

  // --- Strings + char literals (Extended, §V.20, §V.23) ---
  // char ( "name" -- c ) : push the ASCII code of the first char of the next word.
  // Interpret-time word (NOT compile-only): `char a` at top level pushes 97.
  def('char', () => {
    const name = f.parseName()
    if (name === null || name.length === 0) throw new ForthThrow(THROW_UNDEFINED_WORD, 'char')
    d.push(name.charCodeAt(0))
  })
  // [char] (immediate, compile-only) ( "name" -- ) : compile the first char's code
  // as an inline literal. The compile-time counterpart of char.
  def(
    '[char]',
    () => {
      f.compileOnly()
      const name = f.parseName()
      if (name === null || name.length === 0) throw new ForthThrow(THROW_UNDEFINED_WORD, '[char]')
      f.comma(f.litXt)
      f.comma(name.charCodeAt(0))
    },
    true,
  )
  // Compile an inline counted string into the current thread (§V.20): the runtime
  // marker xt, then a count byte + the string bytes, then align so the next xt is
  // cell-aligned. Shared by s" and ." (they differ only in the runtime xt). The
  // leading space after the word is a delimiter, not string content, so skip it
  // (parseName left >IN on it); then parse to the closing quote.
  const compileString = (runtimeXt: number): void => {
    const src = f.regs.source
    if (f.regs.toIn < src.length && src.charCodeAt(f.regs.toIn) === 0x20) f.regs.toIn++
    const text = f.parse('"')
    f.comma(runtimeXt)
    const bytes = f.mem.allot(1) // count byte
    f.mem.setByte(bytes, text.length & 0xff)
    for (let i = 0; i < text.length; i++) {
      f.mem.setByte(f.mem.allot(1), text.charCodeAt(i) & 0xff)
    }
    f.mem.align() // pad the payload so the following xt lands on a CELL boundary
  }
  // s" ( "ccc<quote>" -- ) compiled: ( -- c-addr u ) at run time. Compile-only
  // (§V.23): interpret-state s" has no thread to inline into -> THROW -14.
  def(
    's"',
    () => {
      f.compileOnly()
      compileString(f.sQuoteXt)
    },
    true,
  )
  // ." ( "ccc<quote>" -- ) compiled: prints ccc at run time. Compile-only (§V.23).
  def(
    '."',
    () => {
      f.compileOnly()
      compileString(f.dotQuoteXt)
    },
    true,
  )

  // --- System ---
  def('bye', () => {
    f.regs.running = false
  })
  // throw ( code -- ) : 0 is a no-op; non-zero unwinds to the top-level handler.
  def('throw', () => {
    const code = d.pop()
    if (code !== 0) throw new ForthThrow(code)
  })
  // abort ( -- ) : unconditional THROW -1.
  def('abort', () => {
    throw new ForthThrow(THROW_ABORT)
  })
  // catch ( xt -- code ) : run xt; return 0 if it completes, else the THROW code it
  // raised (§V.17). A sanctioned §V.1 nested-run carve-out: it drives a nested
  // execute()->run() and must save+restore the shared registers so the ENCLOSING
  // trampoline survives. The load-bearing one is `running`: the nested HALT clears
  // it on clean exit, and the outer loop re-checks `while(running)` the instant this
  // primitive returns, so without the restore the caller's body dies after catch.
  //
  // The harness needs NO save/restore despite the code cell overwrite: its address
  // is constant, cell-0 is already consumed (read into w, ip advanced) before the
  // nested execute runs, and cell-1 is always HALT_XT (every execute writes the same
  // value), so the enclosing word's pending return still finds HALT there.
  def('catch', () => {
    const xt = d.pop()
    // Capture AFTER the pop so dsp is the depth catch must restore to on a throw
    // (not one slot too deep, which would resurrect the popped xt).
    const savedDsp = f.regs.dsp
    const savedRsp = f.regs.rsp
    const savedIp = f.regs.ip
    const savedW = f.regs.w
    const savedRunning = f.regs.running
    try {
      f.execute(xt) // nested run(); may ForthThrow
    } catch (e) {
      if (e instanceof ForthThrow) {
        // Unwound past the nested run: restore depths (drops boom's orphaned return
        // frame + any junk it pushed) and the clobbered registers, then push code.
        f.regs.dsp = savedDsp
        f.regs.rsp = savedRsp
        f.regs.ip = savedIp
        f.regs.w = savedW
        f.regs.running = savedRunning
        d.push(e.code)
        return
      }
      throw e // ForthFault / genuine VM fault: propagate (§V.5)
    }
    // Clean exit: the nested HALT clobbered ip/w and cleared running; restore them so
    // the enclosing NEXT resumes. dsp/rsp are NOT restored: the xt's stack results
    // must stand, and rsp is already balanced (HALT follows every EXIT). Push 0.
    f.regs.ip = savedIp
    f.regs.w = savedW
    f.regs.running = savedRunning
    d.push(0)
  })
}

// Capture EXIT's xt for ; to compile. EXIT the word (distinct from the routine).
// Installed last so f.exitXt is set before any thread compiles a `;`.
export const installExit = (f: Forth): void => {
  f.exitXt = f.definePrimitive('exit', EXIT)
}
