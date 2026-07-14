// §T.19 (§V.19) unit tests for the CM6 registry + LoadExample, without constructing a
// real EditorView (happy-dom cannot lay CM6 out; the live editor is browser-verified).
// A minimal stub stands in for the view: enough surface (state.doc.length, dispatch,
// destroy) to prove the registry stores/removes it and LoadExample fires the right
// replace transaction on it.

import { Effect, Option } from 'effect'
import { it } from '@effect/vitest'
import { describe, expect } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { getEditor, removeEditor, setEditor } from './editorHost'
import { LoadExample } from '../run'

// A fake EditorView: records dispatched transactions and reports a fixed doc length.
type Dispatched = { changes: { from: number; to: number; insert: string } }
const makeStubView = (docLength: number) => {
  const dispatched: Array<Dispatched> = []
  let destroyed = false
  const view = {
    state: { doc: { length: docLength } },
    dispatch: (tx: Dispatched) => {
      dispatched.push(tx)
    },
    destroy: () => {
      destroyed = true
    },
  }
  return { view: view as unknown as EditorView, dispatched, isDestroyed: () => destroyed }
}

describe('editorHost registry (§V.19)', () => {
  it('setEditor then getEditor returns the view', () => {
    const { view } = makeStubView(0)
    setEditor('h1', view)
    expect(Option.getOrNull(getEditor('h1'))).toBe(view)
    removeEditor('h1') // cleanup
  })

  it('getEditor is None for an unknown host id', () => {
    expect(Option.isNone(getEditor('never-registered'))).toBe(true)
  })

  it('removeEditor destroys the view and drops it from the registry', () => {
    const { view, isDestroyed } = makeStubView(0)
    setEditor('h2', view)
    removeEditor('h2')
    expect(isDestroyed()).toBe(true)
    expect(Option.isNone(getEditor('h2'))).toBe(true)
  })

  it('removeEditor on an absent host id is a no-op (idempotent)', () => {
    expect(() => removeEditor('absent')).not.toThrow()
  })
})

describe('LoadExample Command (§T.19)', () => {
  it.effect('dispatches a full-document replace transaction on the live view', () =>
    Effect.gen(function* () {
      const { view, dispatched } = makeStubView(11) // existing doc is 11 chars
      setEditor('load-host', view)
      yield* LoadExample({ hostId: Option.some('load-host'), source: 'new text' }).effect
      expect(dispatched).toHaveLength(1)
      // replace the whole existing doc (from 0 to its length) with the new source
      expect(dispatched[0]).toEqual({ changes: { from: 0, to: 11, insert: 'new text' } })
      removeEditor('load-host')
    }),
  )

  it.effect('is a no-op when the host id is None', () =>
    Effect.gen(function* () {
      // no view registered; None hostId must not throw and must dispatch nothing
      yield* LoadExample({ hostId: Option.none(), source: 'x' }).effect
      expect(true).toBe(true)
    }),
  )

  it.effect('is a no-op when the view is not in the registry (mount pending)', () =>
    Effect.gen(function* () {
      yield* LoadExample({ hostId: Option.some('not-mounted'), source: 'x' }).effect
      expect(Option.isNone(getEditor('not-mounted'))).toBe(true)
    }),
  )
})
