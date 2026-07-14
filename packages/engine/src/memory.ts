// @web-forth/engine — flat byte-addressed memory (SPEC §T.2, §V.6, §V.7).
//
// One ArrayBuffer, two aliasing views (platform endianness, consistent across both,
// so `@` and `c@` agree). Dictionary/code/data space grows up from 0 via `here`.
// The top two cells are reserved as the exec-harness (`[xt][HALT]` for execute(),
// §T.5); any alloc reaching that region throws -8 (§V.7). Cell access requires a
// CELL-aligned address (§V.6).

import {
  ForthFault,
  ForthThrow,
  THROW_DICT_OVERFLOW,
  THROW_INVALID_ADDR,
  THROW_UNALIGNED,
} from './errors'

export const CELL = 4
export const DEFAULT_MEM_SIZE = 256 * 1024

export class Memory {
  readonly size: number
  readonly buffer: ArrayBuffer
  readonly cells: Int32Array
  readonly bytes: Uint8Array
  readonly harness: number // byte addr of the reserved 2-cell exec-harness region
  here: number // dictionary pointer (next free byte)

  constructor(size: number = DEFAULT_MEM_SIZE) {
    if (size % CELL !== 0) {
      throw new ForthFault(`memory size ${size} must be a multiple of CELL (${CELL})`)
    }
    if (size < 4 * CELL) {
      throw new ForthFault(`memory size ${size} too small`)
    }
    this.size = size
    this.buffer = new ArrayBuffer(size)
    this.cells = new Int32Array(this.buffer)
    this.bytes = new Uint8Array(this.buffer)
    this.harness = size - 2 * CELL
    this.here = 0
  }

  private bounds(addr: number, span: number): void {
    if (addr < 0 || addr + span > this.size) {
      throw new ForthThrow(THROW_INVALID_ADDR, `address ${addr} out of range`)
    }
  }

  private aligned(addr: number): void {
    if ((addr & (CELL - 1)) !== 0) {
      throw new ForthThrow(THROW_UNALIGNED, `unaligned cell address ${addr}`)
    }
  }

  cellAt(addr: number): number {
    this.bounds(addr, CELL)
    this.aligned(addr)
    return this.cells[addr >> 2] as number
  }

  setCell(addr: number, value: number): void {
    this.bounds(addr, CELL)
    this.aligned(addr)
    this.cells[addr >> 2] = value | 0
  }

  byteAt(addr: number): number {
    this.bounds(addr, 1)
    return this.bytes[addr] as number
  }

  setByte(addr: number, value: number): void {
    this.bounds(addr, 1)
    this.bytes[addr] = value & 0xff
  }

  // Round `here` up to the next CELL boundary.
  align(): void {
    const rem = this.here & (CELL - 1)
    if (rem !== 0) {
      this.here += CELL - rem
    }
  }

  // Reserve `n` bytes at `here`, returning the start address.
  // §V.7: reaching the exec-harness region throws -8.
  allot(n: number): number {
    const start = this.here
    const next = start + n
    if (next > this.harness) {
      throw new ForthThrow(THROW_DICT_OVERFLOW, 'dictionary overflow')
    }
    this.here = next
    return start
  }
}
