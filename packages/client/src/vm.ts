// @web-forth/client Vm service (SPEC.md §T.13, §I.svc). A thin Effect wrapper over the
// pure, mutable @web-forth/engine `Forth`. This is the ONLY place Effect meets the VM
// (§V.2): the engine stays Effect-free; the Foldkit app talks to the VM through this
// service, provided app-wide as `Layer<Vm>` (§I.svc `resources`).
//
// Channel model (§V.5): a Forth error (undefined word, stack underflow, ...) is DATA.
// `forth.interpret` returns it in the RunResult (`throwCode` non-null, message in
// `output`) and does NOT throw. Only a genuine VM fault throws a `ForthFault`. So
// `interpret` here rides the success channel for ordinary errors and only fails the
// Effect E-channel on a ForthFault. Effect v4 detail: a raw JS throw inside `Effect.gen`
// / `Effect.sync` becomes a DEFECT (die), not a typed failure. To land the thrown
// `ForthFault` in the TYPED E-channel we wrap `forth.interpret` in `Effect.try({ try,
// catch })`, whose `catch` maps the thrown value to the failure (Effect.ts try_).
//
// Serialization (§V.13): the mutable core cannot run two interprets at once. A permit-1
// Semaphore in the Layer serializes `interpret`; the update-level Loading guard (§T.15)
// is the primary defense, this is the structural backstop.

import { Context, Effect, Layer, Semaphore } from 'effect'
import { Forth, ForthFault } from '@web-forth/engine'
import type { RunResult, WordInfo } from '@web-forth/engine'

// The service surface (§I.svc). Framework-agnostic method shapes; only the wiring is
// Effect. `interpret` is the sole fallible member (E = ForthFault); the snapshots and
// reset never fault.
export interface VmShape {
  readonly interpret: (source: string) => Effect.Effect<RunResult, ForthFault>
  readonly stackSnapshot: Effect.Effect<ReadonlyArray<number>>
  readonly dictSnapshot: Effect.Effect<ReadonlyArray<WordInfo>>
  readonly reset: Effect.Effect<void>
}

/**
 * The `Vm` service key. Yielding it in an `Effect.gen` (`const vm = yield* Vm`) retrieves
 * the implementation from the current context. Provided app-wide by {@link VmLayer}.
 */
export class Vm extends Context.Service<Vm, VmShape>()('Vm') {}

// Build a service implementation over one fresh Forth, with `interpret` serialized by a
// permit-1 semaphore (§V.13). Kept separate from the Layer so tests can construct it
// directly and inject a fault.
export const makeVm = (semaphore: Semaphore.Semaphore, forth: Forth = new Forth()): VmShape => ({
  interpret: (source) =>
    semaphore.withPermit(
      Effect.try({
        try: () => forth.interpret(source),
        catch: (error) => error as ForthFault,
      }),
    ),
  stackSnapshot: Effect.sync(() => forth.stackSnapshot()),
  dictSnapshot: Effect.sync(() => forth.dictSnapshot()),
  reset: Effect.sync(() => forth.reset()),
})

/**
 * App-wide `Layer<Vm>`. Constructs the permit-1 semaphore and the `Forth` once at layer
 * build time, then provides the serialized service. Pass to `Runtime.makeApplication`'s
 * `resources` field (§I.svc).
 */
export const VmLayer: Layer.Layer<Vm> = Layer.effect(
  Vm,
  Effect.gen(function* () {
    const semaphore = yield* Semaphore.make(1)
    return makeVm(semaphore)
  }),
)
