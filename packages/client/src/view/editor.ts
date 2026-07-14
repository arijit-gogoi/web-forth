// @web-forth/client editor pane (SPEC.md §T.16 Core, §T.19 Extended, §V.19). The
// shipped editor is CodeMirror 6, embedded via the MountEditor host div (a keyed
// branch). CM6's updateListener feeds UpdatedSource and its Mod-Enter keymap feeds
// PressedRun, so the console/run wiring is unchanged.
//
// Keyed branch (foldkit rule): the editor host is wrapped in a single keyed element
// with a stable identity key (which editor, never the source text), so a later swap
// does not tear the wrong DOM.

import { AsyncData } from 'foldkit'
import { html } from 'foldkit/html'
import type { Html } from 'foldkit/html'
import type { Model } from '../model'
import { ClickedReset, ClickedRun, Message } from '../message'
import { EDITOR_HOST_ID, MountEditor } from './mountEditor'

// CM6 host: a mount node the MountEditor constructs the EditorView into. initialDoc is
// captured at mount (Mount args are not refreshed across renders); later external writes
// go through the LoadExample Command, never a re-mount. Mod-Enter -> PressedRun lives
// inside the CM6 keymap, so no OnKeyDownPreventDefault is needed here.
const cm6Editor = (model: Model): Html => {
  const h = html<Message>()
  return h.keyed('div')(
    'editor-cm6',
    [
      h.Class('editor-input editor-cm6'),
      h.OnMount(MountEditor({ hostId: EDITOR_HOST_ID, initialDoc: model.source })),
    ],
    [],
  )
}

export const editorPaneView = (model: Model): Html => {
  const h = html<Message>()
  const isRunning = AsyncData.isPending(model.console)

  return h.section(
    [h.Class('pane editor')],
    [
      h.header([h.Class('pane-header')], ['Editor']),
      cm6Editor(model),
      h.div(
        [h.Class('editor-actions')],
        [
          h.button(
            [h.Class('run-button'), h.Disabled(isRunning), h.OnClick(ClickedRun())],
            [isRunning ? 'Running...' : 'Run  (Ctrl+Enter)'],
          ),
          h.button([h.Class('reset-button'), h.OnClick(ClickedReset())], ['Reset']),
        ],
      ),
    ],
  )
}
