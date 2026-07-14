// @web-forth/engine — shared helper for the primitives/*.ts install fns. Each install
// fn needs the same terse `def(name, routine, immediate?)` wrapper over
// f.definePrimitive; makeDef(f) returns it so the closure is defined once, not copied
// into every group (which fallow flags as a clone).

import type { Routine } from '../inner'
import type { Forth } from '../forth'

// The per-install `def`: register a primitive on f and return its xt (CFA).
export const makeDef =
  (f: Forth) =>
  (name: string, routine: Routine, immediate = false): number =>
    f.definePrimitive(name, routine, immediate)
