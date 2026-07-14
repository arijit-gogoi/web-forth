// Save/load persistence (SPEC §T.25, §V.21, §V.3). The editor buffer autosaves to a
// KeyValueStore (localStorage in the browser) debounced, and restores at boot via flags.
//
// The happy-path read/write is exercised over an in-memory KeyValueStore (layerMemory),
// which is deterministic and needs no DOM. Fail-silence (§V.21) is tested against the real
// flags/SaveSource, which self-provide the BROWSER localStorage layer: the test env has no
// localStorage, so that layer errors, which is exactly the "storage disabled" case, and
// flags/SaveSource must fold it to the seed / CompletedSave without throwing. The debounce
// generation guard is tested purely through the update function with Story (no timers).

import { Effect, Option } from 'effect'
import { KeyValueStore } from 'effect/unstable/persistence'
import { it } from '@effect/vitest'
import { Story } from 'foldkit'
import { describe, expect, test } from 'vitest'
import { update } from './main'
import { flags, init, INITIAL_SOURCE, readSavedSource } from './model'
import { CompletedSave, SaveTick, UpdatedSource } from './message'
import { DebounceSave, SaveSource, writeSavedSource } from './run'
import { STORAGE_KEY } from './persistence'

const canned = () => CompletedSave()

describe('read/write over an in-memory store (§T.25)', () => {
  it.effect('a written buffer round-trips back through readSavedSource', () =>
    Effect.gen(function* () {
      yield* writeSavedSource(': persisted 1 ;')
      const restored = yield* readSavedSource
      expect(restored.initialSource).toBe(': persisted 1 ;')
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  )

  it.effect('an absent key restores the seed source', () =>
    Effect.gen(function* () {
      const restored = yield* readSavedSource
      expect(restored.initialSource).toBe(INITIAL_SOURCE)
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  )

  it.effect('an empty saved string restores as empty (persist what is there)', () =>
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore
      yield* store.set(STORAGE_KEY, '')
      const restored = yield* readSavedSource
      expect(restored.initialSource).toBe('')
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  )
})

describe('fail-silent when storage is unavailable (§V.21)', () => {
  it.effect('flags yields the seed source instead of failing', () =>
    Effect.gen(function* () {
      // flags self-provides the browser localStorage layer; the test env has none, so it
      // errors, and flags must fold that to the seed (never propagate a failure).
      const restored = yield* flags
      expect(restored.initialSource).toBe(INITIAL_SOURCE)
    }),
  )

  it.effect('SaveSource yields CompletedSave instead of failing', () =>
    Effect.gen(function* () {
      const message = yield* SaveSource({ source: 'anything' }).effect
      expect(message._tag).toBe('CompletedSave')
    }),
  )
})

describe('init seeds source from flags (§T.25)', () => {
  test('init places the restored text into model.source at generation 0', () => {
    const [model] = init({ initialSource: ': restored 7 ;' })
    expect(model.source).toBe(': restored 7 ;')
    expect(model.saveGeneration).toBe(0)
  })
})

describe('debounce generation guard (§T.25, §V.21)', () => {
  test('an edit bumps the generation and a matching SaveTick fires a save', () => {
    Story.story(
      update,
      Story.with(init({ initialSource: INITIAL_SOURCE })[0]),
      Story.message(UpdatedSource({ value: '1 2 +' })),
      Story.model((model) => {
        expect(model.source).toBe('1 2 +')
        expect(model.saveGeneration).toBe(1)
      }),
      // the scheduled DebounceSave timer resolves to a SaveTick for generation 1
      Story.Command.resolve(DebounceSave, SaveTick({ generation: 1 })),
      // that SaveTick still matches the current generation -> a SaveSource fires
      Story.Command.expectHas(SaveSource({ source: '1 2 +' })),
      Story.Command.resolve(SaveSource, canned()),
    )
  })

  test('a stale SaveTick is dropped: NO save (this is the debounce)', () => {
    // Start already at generation 5; a SaveTick carrying an older generation 3 is stale
    // (a newer edit superseded it in the window), so the guard drops it: no SaveSource.
    Story.story(
      update,
      Story.with({ ...init({ initialSource: INITIAL_SOURCE })[0], saveGeneration: 5 }),
      Story.message(SaveTick({ generation: 3 })),
      Story.Command.expectNone(),
    )
  })

  test('a SaveTick matching the current generation fires exactly one save', () => {
    Story.story(
      update,
      Story.with({ ...init({ initialSource: INITIAL_SOURCE })[0], source: 'x', saveGeneration: 5 }),
      Story.message(SaveTick({ generation: 5 })),
      Story.Command.expectExact(SaveSource({ source: 'x' })),
      Story.Command.resolve(SaveSource, canned()),
    )
  })
})

describe('Model shape (§V.3)', () => {
  test('the Model holds only source + snapshots + scalars, no mutable handle', () => {
    const [model] = init({ initialSource: INITIAL_SOURCE })
    expect(typeof model.source).toBe('string')
    expect(typeof model.saveGeneration).toBe('number')
    expect(Option.isOption(model.maybeEditorHostId)).toBe(true)
  })
})
