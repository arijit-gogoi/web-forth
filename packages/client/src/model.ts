// @web-forth/client Model (SPEC.md §T.14, §V.3, §V.4). Schema-typed. Holds ONLY UI
// state and read-only snapshots (§V.3): the editor text, the console lifecycle as
// AsyncData, and a copied dictionary snapshot. No mutable VM handle ever lives here; the
// Forth/Vm is an Effect service, the data-stack snapshot is a plain copied array (§V.4).

import { Schema as S } from 'effect'
import { AsyncData, Runtime } from 'foldkit'
import { RunData, WordEntry } from './message'
import type { Message } from './message'

// The console lifecycle. AsyncData.Schema builds the six-state union codec plus typed
// constructors; the app uses four visual states via matchDataSplitEmpty (idle, loading,
// failure, data). Data channel = RunData (output + stack + throwCode); error channel =
// the ForthFault message string.
export const ConsoleAsyncData = AsyncData.Schema(RunData, S.String)

export const Model = S.Struct({
  source: S.String,
  console: ConsoleAsyncData.schema,
  dictionary: S.Array(WordEntry),
})
export type Model = typeof Model.Type

const INITIAL_SOURCE = ': square dup * ;\n5 square .\n'

// Fresh state: seed the editor with a runnable example, an idle console, and an empty
// dictionary (the real snapshot arrives after the first run).
export const init: Runtime.ApplicationInit<Model, Message> = () => [
  {
    source: INITIAL_SOURCE,
    console: ConsoleAsyncData.Idle(),
    dictionary: [],
  },
  [],
]
