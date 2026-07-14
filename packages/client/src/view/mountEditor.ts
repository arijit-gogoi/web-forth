// @web-forth/client CodeMirror 6 editor Mount (SPEC.md §T.19, §R.2, §V.19). CM6's
// updateListener and keymap are extensions wired at CONSTRUCTION on the mount node and
// fire continuously (every keystroke, every Mod-Enter), so this is a Mount.defineStream
// (the authoritative rule: "continuous events from listeners or observers"). The body
// mirrors the SyncSidebarScroll template in defineStream's own TSDoc: Stream.callback ->
// Effect.acquireRelease (construct the view + register it, release destroys it) -> never.
//
// The EditorView is the only mutable, non-Schema handle; it never enters the Model. It is
// stashed in the editorHost registry keyed by hostId (§V.19); the Model holds only
// Option<hostId>. Document edits feed UpdatedSource and Mod-Enter feeds PressedRun, the
// SAME facts the Core textarea produces, so nothing downstream changes (specs/01 §C).
// initialDoc is captured at mount (Mount args are not refreshed across renders); ongoing
// external writes go through the LoadExample Command, never a re-mount.

import { Effect, Queue, Schema as S, Stream } from 'effect'
import { Mount } from 'foldkit'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { PressedRun, UpdatedSource } from '../message'
import { setEditor, removeEditor } from './editorHost'
import { forthLanguageSupport } from './forthLanguage'

// The single editor pane's host id. One editor in the app, so a constant suffices.
export const EDITOR_HOST_ID = 'web-forth-editor'

type EditorMessage = typeof UpdatedSource.Type | typeof PressedRun.Type

export const MountEditor = Mount.defineStream(
  'MountEditor',
  { hostId: S.String, initialDoc: S.String },
  UpdatedSource,
  PressedRun,
)(
  ({ hostId, initialDoc }) =>
    (element) =>
      Stream.callback<EditorMessage>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const state = EditorState.create({
              doc: initialDoc,
              extensions: [
                history(),
                ...forthLanguageSupport, // §T.26 Forth syntax highlighting
                keymap.of([
                  {
                    key: 'Mod-Enter',
                    run: () => {
                      Queue.offerUnsafe(queue, PressedRun())
                      return true
                    },
                  },
                  ...defaultKeymap,
                  ...historyKeymap,
                ]),
                EditorView.updateListener.of((viewUpdate) => {
                  if (viewUpdate.docChanged) {
                    Queue.offerUnsafe(
                      queue,
                      UpdatedSource({ value: viewUpdate.state.doc.toString() }),
                    )
                  }
                }),
                EditorView.lineWrapping,
              ],
            })
            const view = new EditorView({ state, parent: element })
            setEditor(hostId, view) // registry, out of the Model (§V.19)
            return view
          }),
          () => Effect.sync(() => removeEditor(hostId)), // teardown on unmount
        ).pipe(Effect.andThen(Effect.never)),
      ),
)
