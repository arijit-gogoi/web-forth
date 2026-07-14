// @web-forth/engine — dictionary header build + FIND (SPEC §T.4, §V.11).
//
// A word (dictionary entry) is laid out in main memory (§02):
//
//   +0    link      : CELL   byte addr of previous word's link field; 0 terminates
//   +4    lenflags  : 1 byte  bit7 IMMEDIATE, bit6 HIDDEN(smudge), bits0-5 name length
//   +5    name      : len bytes (ASCII)
//         ...pad to CELL alignment...
//   CFA   code field : CELL   routine index into code[]   <-- xt (execution token)
//   PFA   param field : body (per word class)
//
// The CFA cell holds a routine index (indirect-threaded, routine-index dispatch);
// its ADDRESS is the xt. FIND returns { xt, immediate } so the outer interpreter
// (§T.7) can execute or compile it.
//
// Address-0 reservation (load-bearing): makeRegisters() seeds latest=0 and Memory
// seeds here=0, and a link field of 0 is the end-of-chain sentinel. If the first
// header's link landed at address 0, latest==0 would be ambiguous with "empty
// dictionary" and the first word would be invisible to FIND. So the dictionary
// reserves a boot cell at address 0 (start = CELL) and never lays a header there.
// That boot cell is also where §T.5 installs HALT's routine index (HALT_XT = 0),
// so the two constraints resolve to the same reserved cell.

import { ForthThrow, THROW_DICT_OVERFLOW } from './errors'
import { CELL, Memory } from './memory'
import type { Registers } from './registers'

// lenflags byte bit layout.
export const FLAG_IMMEDIATE = 0x80
export const FLAG_HIDDEN = 0x40 // smudge bit
export const NAME_LEN_MASK = 0x3f // bits 0-5 -> max name length 63

// Field offsets from a header's link-field address.
export const LINK_OFFSET = 0
export const LENFLAGS_OFFSET = CELL
export const NAME_OFFSET = CELL + 1

// The boot cell reserved at address 0 (see header comment). One CELL.
export const BOOT_RESERVED = CELL

export interface FindResult {
  readonly xt: number // byte addr of the CFA cell
  readonly immediate: boolean
}

export class Dictionary {
  private readonly mem: Memory
  private readonly regs: Registers

  constructor(mem: Memory, regs: Registers) {
    this.mem = mem
    this.regs = regs
    this.reserveBootCell()
  }

  // Reserve address 0 (the boot cell) so no header link field ever collides with the
  // empty/end-of-chain sentinel. Idempotent-ish: only advances here if it is still
  // below the boot region (fresh or just-reset). §T.5 installs HALT into this cell.
  reserveBootCell(): void {
    if (this.mem.here < BOOT_RESERVED) {
      this.mem.allot(BOOT_RESERVED - this.mem.here)
    }
  }

  // Build a header for `name` at HERE (CELL-aligned), link it to the previous
  // word, and update LATEST. Returns the CFA address (xt). The caller lays the
  // body after the CFA (colon list, DOVAR slots, etc.) in later tasks.
  //
  // The CFA cell is guaranteed CELL-aligned so §T.5's cell(w) dispatch never
  // hits the -23 alignment throw.
  header(name: string, immediate = false): number {
    if (name.length === 0 || name.length > NAME_LEN_MASK) {
      // Names are 1..63 bytes; bits 0-5 hold the length. Reject rather than
      // silently corrupt the flag bits.
      throw new ForthThrow(THROW_DICT_OVERFLOW, `word name length ${name.length} out of range`)
    }

    this.mem.align()
    const link = this.mem.here
    const prev = this.regs.latest

    // link field
    this.mem.allot(CELL)
    this.mem.setCell(link, prev)

    // lenflags byte
    const flags = (immediate ? FLAG_IMMEDIATE : 0) | (name.length & NAME_LEN_MASK)
    this.mem.allot(1)
    this.mem.setByte(link + LENFLAGS_OFFSET, flags)

    // name bytes (ASCII)
    this.mem.allot(name.length)
    for (let i = 0; i < name.length; i++) {
      this.mem.setByte(link + NAME_OFFSET + i, name.charCodeAt(i) & 0xff)
    }

    // pad to CELL so the CFA lands on a boundary
    this.mem.align()
    const cfa = this.mem.here
    this.mem.allot(CELL) // reserve the CFA cell itself

    this.regs.latest = link
    return cfa
  }

  // Walk the LATEST chain newest-first; case-insensitive name compare. Skips
  // HIDDEN (smudged) words. Returns { xt, immediate } or null.
  find(name: string): FindResult | null {
    const target = name.toLowerCase()
    let link = this.regs.latest
    while (link !== 0) {
      const lenflags = this.mem.byteAt(link + LENFLAGS_OFFSET)
      const hidden = (lenflags & FLAG_HIDDEN) !== 0
      const len = lenflags & NAME_LEN_MASK
      if (!hidden && len === target.length && this.nameEquals(link, target)) {
        return {
          xt: this.cfaOf(link),
          immediate: (lenflags & FLAG_IMMEDIATE) !== 0,
        }
      }
      link = this.mem.cellAt(link + LINK_OFFSET)
    }
    return null
  }

  // Case-insensitive compare of the stored name against an already-lowercased target.
  private nameEquals(link: number, lowerTarget: string): boolean {
    for (let i = 0; i < lowerTarget.length; i++) {
      const c = this.mem.byteAt(link + NAME_OFFSET + i)
      // fold ASCII upper -> lower
      const folded = c >= 0x41 && c <= 0x5a ? c + 0x20 : c
      if (folded !== lowerTarget.charCodeAt(i)) {
        return false
      }
    }
    return true
  }

  // CFA (xt) address for a header at `link`: name padded up to a CELL boundary.
  cfaOf(link: number): number {
    const afterName = link + NAME_OFFSET + (this.mem.byteAt(link + LENFLAGS_OFFSET) & NAME_LEN_MASK)
    const rem = afterName & (CELL - 1)
    return rem === 0 ? afterName : afterName + (CELL - rem)
  }

  // Flag accessors on the header at `link`.
  isImmediate(link: number): boolean {
    return (this.mem.byteAt(link + LENFLAGS_OFFSET) & FLAG_IMMEDIATE) !== 0
  }

  isHidden(link: number): boolean {
    return (this.mem.byteAt(link + LENFLAGS_OFFSET) & FLAG_HIDDEN) !== 0
  }

  setImmediate(link: number, on = true): void {
    this.setFlag(link, FLAG_IMMEDIATE, on)
  }

  // Smudge/reveal: hide a half-compiled word from FIND, then reveal it.
  setHidden(link: number, on = true): void {
    this.setFlag(link, FLAG_HIDDEN, on)
  }

  private setFlag(link: number, flag: number, on: boolean): void {
    const cur = this.mem.byteAt(link + LENFLAGS_OFFSET)
    this.mem.setByte(link + LENFLAGS_OFFSET, on ? cur | flag : cur & ~flag)
  }
}

// >BODY ( xt -- pfa ): CREATE-class words use a 2-slot code field
// [CFA=DOVAR][doesCodeAddr], so the parameter field is CFA + 2*CELL (§V.11).
export const toBody = (cfa: number): number => cfa + 2 * CELL
