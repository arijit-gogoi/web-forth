// @web-forth/client editor pane (SPEC.md §T.16, §I.app). Core = a textarea (CM6 is Extended,
// §T.19). The controlled value is model.source; OnInput feeds UpdatedSource; Ctrl+Enter
// runs via OnKeyDownPreventDefault (scoped to editor focus, returns Option so other keys
// pass through). A Run button and a Reset button drive ClickedRun / ClickedReset.

import { Option } from 'effect'
import { AsyncData } from 'foldkit'
import { html } from 'foldkit/html'
import type { Html } from 'foldkit/html'
import type { Model } from '../model'
import { ClickedReset, ClickedRun, Message, PressedRun, UpdatedSource } from '../message'

export const editorPaneView = (model: Model): Html => {
  const h = html<Message>()
  const isRunning = AsyncData.isPending(model.console)

  return h.section(
    [h.Class('pane editor')],
    [
      h.header([h.Class('pane-header')], ['Editor']),
      h.textarea(
        [
          h.Class('editor-input'),
          h.Value(model.source),
          h.Spellcheck(false),
          h.OnInput((value) => UpdatedSource({ value })),
          h.OnKeyDownPreventDefault((key, modifiers) =>
            key === 'Enter' && (modifiers.ctrlKey || modifiers.metaKey)
              ? Option.some(PressedRun())
              : Option.none(),
          ),
        ],
        [],
      ),
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
