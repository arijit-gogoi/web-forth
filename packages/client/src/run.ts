// @web-forth/client run Commands (SPEC.md §T.15, §V.5, §V.13). Colocated with the update
// that returns them (foldkit idiom). RunSource reads the Vm service from the resources
// Layer (R channel), runs the current source, and folds the result into a Message.
//
// Channel model (§V.5): vm.interpret rides the SUCCESS channel for ordinary Forth errors
// (RunResult with a non-null throwCode) and only FAILS the E-channel on a ForthFault. So
// the happy path is CompletedRun (carrying the RunData + dictionary snapshot); the
// Effect.catch branch maps a genuine fault to FailedRun.

import { Effect, Schema as S } from 'effect'
import { AsyncData, Command } from 'foldkit'
import { evo } from 'foldkit/struct'
import { Vm } from './vm'
import { CompletedRun, FailedRun, WordEntry } from './message'
import type { Model } from './model'
import type { WordInfo } from '@web-forth/engine'

// Copy the engine's dictionary snapshot into the Schema-typed WordEntry shape the Model
// holds (§V.4: snapshots cross, never the live structures).
const toWordEntries = (words: ReadonlyArray<WordInfo>): ReadonlyArray<typeof WordEntry.Type> =>
  words.map((word) => ({ name: word.name, immediate: word.immediate, hidden: word.hidden }))

/**
 * Run the editor source against the Vm and yield CompletedRun with the output, a copied
 * data-stack snapshot, the throw code, and a fresh dictionary snapshot. A ForthFault is
 * folded to FailedRun so a side effect never crashes the app.
 */
export const RunSource = Command.define(
  'RunSource',
  { source: S.String },
  CompletedRun,
  FailedRun,
)(({ source }) =>
  Effect.gen(function* () {
    const vm = yield* Vm
    const result = yield* vm.interpret(source)
    const dictionary = yield* vm.dictSnapshot
    return CompletedRun({
      result: { output: result.output, stack: result.stack, throwCode: result.throwCode },
      dictionary: toWordEntries(dictionary),
    })
  }).pipe(Effect.catch((error) => Effect.succeed(FailedRun({ error: String(error) })))),
)

/**
 * Reset the VM to a fresh boot state, then report the cleared console + fresh dictionary
 * via CompletedRun. A ForthFault folds to FailedRun.
 */
export const ResetVm = Command.define('ResetVm', {}, CompletedRun, FailedRun)(() =>
  Effect.gen(function* () {
    const vm = yield* Vm
    yield* vm.reset
    const dictionary = yield* vm.dictSnapshot
    return CompletedRun({
      result: { output: '', stack: [], throwCode: null },
      dictionary: toWordEntries(dictionary),
    })
  }).pipe(Effect.catch((error) => Effect.succeed(FailedRun({ error: String(error) })))),
)

// Move the console into its pending state for a fresh run (§V.13 makes update ignore new
// run requests while this holds).
export const runningModel = (model: Model): Model =>
  evo(model, { console: () => AsyncData.Loading() })
