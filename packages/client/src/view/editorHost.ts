// @web-forth/client CodeMirror host registry (SPEC.md §T.19, §V.19). The CM6
// EditorView is a mutable, non-Schema handle, so it may NOT live in the Model
// (§V.3/§V.19). It lives here in a module-level Map keyed by hostId; the Model holds
// only Option<hostId>. The MountEditor stashes the view on construction and removes
// it on unmount; the LoadExample Command reaches the live view to push content in.
// Same pattern as the map example's mapHost.ts (specs/01 §C).

import { Function as Fn, Option } from 'effect'
import type { EditorView } from '@codemirror/view'

const editorsByHostId = new Map<string, EditorView>()

export const setEditor = (hostId: string, view: EditorView): void => {
  editorsByHostId.set(hostId, view)
}

export const getEditor = (hostId: string): Option.Option<EditorView> =>
  Option.fromNullishOr(editorsByHostId.get(hostId))

// Remove and destroy the view for hostId, if present (idempotent). Called from the
// Mount's release on unmount; destroying frees CM6's DOM + listeners (§V.19).
export const removeEditor = (hostId: string): void =>
  Option.match(getEditor(hostId), {
    onNone: Fn.constVoid,
    onSome: (view) => {
      view.destroy()
      editorsByHostId.delete(hostId)
    },
  })
