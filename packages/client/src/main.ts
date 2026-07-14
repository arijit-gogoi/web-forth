// @web-forth/client app (SPEC.md §T.14). Model/Message/init live in their own files;
// this is the update + view composition. The RunSource Command and its console wiring
// land in §T.15; the editor/console/inspector panes fill in §T.16-18. Here the skeleton
// boots: an exhaustive update and a three-pane view shell.

import { Match as M } from 'effect'
import { AsyncData, Command } from 'foldkit'
import { html } from 'foldkit/html'
import type { Document } from 'foldkit/html'
import { evo } from 'foldkit/struct'
import { Flags, flags, init, INITIAL_SOURCE, Model } from './model'
import { Message } from './message'
import { DebounceSave, LoadExample, ResetVm, RunSource, runningModel, SaveSource } from './run'
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
      // An edit updates the source and schedules a debounced autosave (§T.25). Bumping
      // the generation invalidates any in-flight save timer; DebounceSave carries the new
      // generation and, after the window, only saves if it is still the latest.
      UpdatedSource: ({ value }) => {
        const nextGeneration = model.saveGeneration + 1
        return [
          evo(model, { source: () => value, saveGeneration: () => nextGeneration }),
          [DebounceSave({ generation: nextGeneration })],
        ]
      },

      // §V.13: ignore a run request while one is in flight (console pending). The Vm
      // service also serializes, this is the primary guard. ClickedRun and PressedRun
      // are the same effect from different origins.
      ClickedRun: () => startRun(model),
      PressedRun: () => startRun(model),

      // Reset clears the VM and console, re-seeds the editor to the initial example,
      // pushes that text into the live CM6 view (LoadExample), and persists it (§T.25:
      // Reset sets source directly, not via UpdatedSource, so it bumps the generation and
      // schedules its own save, else a reload after reset would restore the old text). The
      // source Model field and the CM6 doc stay in lockstep (§V.19).
      ClickedReset: () => {
        const nextGeneration = model.saveGeneration + 1
        return [
          evo(model, {
            source: () => INITIAL_SOURCE,
            console: () => AsyncData.Idle(),
            dictionary: () => [],
            saveGeneration: () => nextGeneration,
          }),
          [
            ResetVm({}),
            LoadExample({ hostId: model.maybeEditorHostId, source: INITIAL_SOURCE }),
            DebounceSave({ generation: nextGeneration }),
          ],
        ]
      },

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

      // §T.25 debounce guard: the save timer fired. Save only if this generation is still
      // the latest (no newer edit superseded it in the window); otherwise drop it (a
      // stale window a newer edit already replaced).
      SaveTick: ({ generation }) =>
        generation === model.saveGeneration
          ? [model, [SaveSource({ source: model.source })]]
          : [model, []],

      // Fire-and-forget ack from SaveSource: the write completed (or failed silently,
      // §V.21). Nothing to fold.
      CompletedSave: () => [model, []],
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

export { Flags, flags, init, Model }
export { Message } from './message'
