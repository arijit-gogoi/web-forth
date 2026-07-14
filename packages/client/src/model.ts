// @web-forth/client Model (SPEC.md §T.14, §V.3, §V.4). Schema-typed. Holds ONLY UI
// state and read-only snapshots (§V.3): the editor text, the console lifecycle as
// AsyncData, and a copied dictionary snapshot. No mutable VM handle ever lives here; the
// Forth/Vm is an Effect service, the data-stack snapshot is a plain copied array (§V.4).

import { Effect, Option, Schema as S } from 'effect'
import { KeyValueStore } from 'effect/unstable/persistence'
import { AsyncData, Runtime } from 'foldkit'
import { BrowserKeyValueStore } from '@effect/platform-browser'
import { RunData, WordEntry } from './message'
import type { Message } from './message'
import { EDITOR_HOST_ID } from './view/mountEditor'
import { STORAGE_KEY } from './persistence'

// The console lifecycle. AsyncData.Schema builds the six-state union codec plus typed
// constructors; the app uses four visual states via matchDataSplitEmpty (idle, loading,
// failure, data). Data channel = RunData (output + stack + throwCode); error channel =
// the ForthFault message string.
export const ConsoleAsyncData = AsyncData.Schema(RunData, S.String)

// maybeEditorHostId (§V.3/§V.19): the CM6 EditorView is a mutable handle kept in the
// module registry (view/editorHost.ts), NEVER in the Model. The Model holds only this
// Option<hostId> so Commands (LoadExample) can find the live view. One editor exists, so
// the id is a constant, set from init; the actual view is constructed by the Mount.
//
// saveGeneration (§T.25): a monotonically increasing token for the debounced autosave. An
// edit bumps it and schedules a save carrying the new value; when the debounce window
// elapses, the save runs only if the generation still matches (else a newer edit won).
export const Model = S.Struct({
  source: S.String,
  console: ConsoleAsyncData.schema,
  dictionary: S.Array(WordEntry),
  maybeEditorHostId: S.Option(S.String),
  saveGeneration: S.Number,
})
export type Model = typeof Model.Type

export const INITIAL_SOURCE = ': square dup * ;\n5 square .\n'

// FLAGS (§T.25, §V.21): read the saved editor buffer from localStorage at boot. Fail
// silent: storage disabled or absent yields the seed source, never a crash. Runs BEFORE
// the editor mounts, so the restored text is in model.source when MountEditor captures
// initialDoc (no reconcile race). Stored as the raw string (not JSON), since it is one.
export const Flags = S.Struct({ initialSource: S.String })
export type Flags = typeof Flags.Type

// The restore effect over an abstract KeyValueStore (testable with layerMemory). A missing
// key yields the seed. Fail-silent is applied by the caller wrapping this in Effect.catch;
// a KeyValueStore error rides its E-channel until then.
export const readSavedSource: Effect.Effect<
  Flags,
  KeyValueStore.KeyValueStoreError,
  KeyValueStore.KeyValueStore
> = Effect.gen(function* () {
  const store = yield* KeyValueStore.KeyValueStore
  const maybeSaved = Option.fromNullishOr(yield* store.get(STORAGE_KEY))
  return { initialSource: Option.getOrElse(maybeSaved, () => INITIAL_SOURCE) }
})

// The boot flags: read from localStorage, fail-silent to the seed (§V.21), and provide the
// browser store. makeApplication requires Effect<Flags> with no remaining requirements.
export const flags: Effect.Effect<Flags> = readSavedSource.pipe(
  Effect.catch(() => Effect.succeed({ initialSource: INITIAL_SOURCE })),
  Effect.provide(BrowserKeyValueStore.layerLocalStorage),
)

// Fresh state: seed the editor from flags (the restored buffer, or the runnable example),
// an idle console, an empty dictionary (the real snapshot arrives after the first run),
// the editor host id (the CM6 Mount always renders), and generation 0.
export const init: Runtime.ApplicationInit<Model, Message, Flags> = (bootFlags) => [
  {
    source: bootFlags.initialSource,
    console: ConsoleAsyncData.Idle(),
    dictionary: [],
    maybeEditorHostId: Option.some(EDITOR_HOST_ID),
    saveGeneration: 0,
  },
  [],
]
