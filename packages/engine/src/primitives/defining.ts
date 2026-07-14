// @web-forth/engine — the data-defining words: variable/constant (Core) and the
// CREATE/DOES>/>BODY family (Extended, §V.11, §V.24). Split out of forth.ts;
// installPrimitives() calls installDataDefining() after the control-flow immediates.
//
// CREATE-class words share the 2-slot CFA layout [routine][doesCodeAddr]; the body
// starts at CFA+2*CELL (§V.11). CONSTANT is the 1-slot [DOCONST][value] exception.

import { ForthThrow, THROW_INVALID_ADDR, THROW_UNDEFINED_WORD } from '../errors'
import { CELL } from '../memory'
import { toBody } from '../dictionary'
import type { Forth } from '../forth'
import { makeDef } from './shared'

export const installDataDefining = (f: Forth): void => {
  const d = f.dstack
  const def = makeDef(f)

  // --- Defining words for data (CREATE-class; DOES> is Extended, §V.11) ---
  // variable ( "name" -- ) : CFA=[DOVAR][doesCodeAddr=0][body cell]. Pushes PFA.
  def('variable', () => {
    const name = f.parseName()
    if (name === null) throw new ForthThrow(THROW_UNDEFINED_WORD, 'variable')
    const cfa = f.dict.header(name)
    f.mem.setCell(cfa, f.dovarIndex)
    f.comma(0) // doesCodeAddr slot (2-slot layout, §V.11)
    f.comma(0) // one body cell, initialized to 0
  })
  // constant ( n "name" -- ) : CFA=[DOCONST][value]. Pushes the stored value.
  def('constant', () => {
    const name = f.parseName()
    if (name === null) throw new ForthThrow(THROW_UNDEFINED_WORD, 'constant')
    const value = d.pop()
    const cfa = f.dict.header(name)
    f.mem.setCell(cfa, f.doconstIndex)
    f.comma(value)
  })

  // --- CREATE / DOES> / >BODY (Extended, §V.11, §V.24) ---
  // create ( "name" -- ) : CFA=[DOVAR][doesCodeAddr=0], no body cells (allot on
  // demand). Same 2-slot layout as variable so DOES> and >BODY slot in. Pushing
  // the PFA is DOVAR's job; DOES> later rewrites the CFA routine to DODOES.
  def('create', () => {
    const name = f.parseName()
    if (name === null) throw new ForthThrow(THROW_UNDEFINED_WORD, 'create')
    const cfa = f.dict.header(name)
    f.mem.setCell(cfa, f.dovarIndex)
    f.comma(0) // doesCodeAddr slot (2-slot layout, §V.11); 0 until DOES> sets it
  })
  // does> (immediate, compile-only) : end the defining word's pre-DOES> part by
  // compiling (does>), then let the DOES> code fall through as an inline thread.
  // At the defining word's runtime, (does>) patches the just-created word.
  def(
    'does>',
    () => {
      f.compileOnly()
      f.comma(f.dodoesXt) // compile the (does>) runtime marker
    },
    true,
  )
  // (does>) runtime: executed while the defining word runs, right after it has
  // CREATEd the child. Point the child's CFA routine at DODOES and its
  // doesCodeAddr slot at the code right after this marker (the DOES> thread),
  // then EXIT the defining word so the DOES> code does not run at define time.
  f.dodoesXt = def('(does>)', (v) => {
    const childCfa = f.dict.cfaOf(v.regs.latest)
    v.mem.setCell(childCfa, f.dodoesIndex) // child now behaves as DODOES
    v.mem.setCell(childCfa + CELL, v.regs.ip) // doesCodeAddr -> DOES> thread start
    v.regs.ip = v.rstack.pop() // EXIT the defining word
  })
  // >body ( xt -- pfa ) : parameter field of a CREATE-class word (CFA+2*CELL,
  // §V.11). §V.24: only valid for CREATE-class words (CFA routine DOVAR|DODOES);
  // a colon/constant/primitive xt has no such body -> THROW -9.
  def('>body', () => {
    const cfa = d.pop()
    const routine = f.mem.cellAt(cfa)
    if (routine !== f.dovarIndex && routine !== f.dodoesIndex) {
      throw new ForthThrow(THROW_INVALID_ADDR, '>body on a non-CREATE word')
    }
    d.push(toBody(cfa))
  })
}
