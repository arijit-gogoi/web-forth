// @web-forth/client app (SPEC.md §T.14). Model/Message/init live in their own files;
// this is the update + view composition. The RunSource Command and its console wiring
// land in §T.15; the editor/console/inspector panes fill in §T.16-18. Here the skeleton
// boots: an exhaustive update and a three-pane view shell.

import { Match as M } from 'effect'
import { AsyncData, Command } from 'foldkit'
import { html } from 'foldkit/html'
import type { Document } from 'foldkit/html'
import { evo } from 'foldkit/struct'
import { init, INITIAL_SOURCE, Model } from './model'
import { Message } from './message'
import { LoadExample, ResetVm, RunSource, runningModel } from './run'
import type { Vm } from './vm'
import { editorPaneView } from './view/editor'
import { consolePaneView } from './view/console'
import { inspectorPaneView } from './view/inspector'

// UPDATE

export const update = (
  model: Model,
  message: Message,
): readonly [Model, ReadonlyArray<Command.Command<Message, never, Vm>>] =>
  M.value(message).pipe(
    M.withReturnType<readonly [Model, ReadonlyArray<Command.Command<Message, never, Vm>>]>(),
    M.tagsExhaustive({
      UpdatedSource: ({ value }) => [evo(model, { source: () => value }), []],

      // §V.13: ignore a run request while one is in flight (console pending). The Vm
      // service also serializes, this is the primary guard. ClickedRun and PressedRun
      // are the same effect from different origins.
      ClickedRun: () => startRun(model),
      PressedRun: () => startRun(model),

      // Reset clears the VM and console, re-seeds the editor to the initial example,
      // and pushes that text into the live CM6 view (LoadExample). The source Model
      // field and the CM6 doc stay in lockstep (§V.19: external writes go through a
      // transaction on the registry-held view, never a re-mount).
      ClickedReset: () => [
        evo(model, {
          source: () => INITIAL_SOURCE,
          console: () => AsyncData.Idle(),
          dictionary: () => [],
        }),
        [ResetVm({}), LoadExample({ hostId: model.maybeEditorHostId, source: INITIAL_SOURCE })],
      ],

      // §V.5: a completed run (including a Forth error) is Success; throwCode rides in
      // the data. The dictionary snapshot updates alongside.
      CompletedRun: ({ result, dictionary }) => [
        evo(model, {
          console: () => AsyncData.Success({ data: result }),
          dictionary: () => dictionary,
        }),
        [],
      ],

      // Genuine VM fault: the rare E-channel case.
      FailedRun: ({ error }) => [evo(model, { console: () => AsyncData.Failure({ error }) }), []],

      // Fire-and-forget ack from LoadExample: the source Model field already changed,
      // so there is nothing to fold (§T.19).
      CompletedLoadExample: () => [model, []],
    }),
  )

const startRun = (
  model: Model,
): readonly [Model, ReadonlyArray<Command.Command<Message, never, Vm>>] => {
  if (AsyncData.isPending(model.console)) {
    return [model, []]
  }
  return [runningModel(model), [RunSource({ source: model.source })]]
}

// VIEW

export const view = (model: Model): Document => {
  const h = html<Message>()
  return {
    title: 'web-forth',
    body: h.div(
      [h.Class('app')],
      [editorPaneView(model), consolePaneView(model), inspectorPaneView(model)],
    ),
  }
}

export { init, Model }
export { Message } from './message'
