// @web-forth/client console pane (SPEC.md §T.17, §V.5). Renders the console AsyncData
// with one keyed branch per visual state (idle, loading, failure, data). A Forth error is
// a DATA state (Success) whose throwCode is non-null and whose message is already in the
// output text (§V.5); only a genuine ForthFault reaches the failure branch.

import { AsyncData } from 'foldkit'
import { html } from 'foldkit/html'
import type { Html } from 'foldkit/html'
import type { Model } from '../model'
import type { RunData } from '../message'
import type { Message } from '../message'

const outputView = (result: RunData): Html => {
  const h = html<Message>()
  const isError = result.throwCode !== null
  const body = result.output.length === 0 ? (isError ? '' : '(no output)') : result.output
  return h.pre(
    [h.Class(isError ? 'console-output console-error' : 'console-output')],
    [body],
  )
}

export const consolePaneView = (model: Model): Html => {
  const h = html<Message>()

  return h.section(
    [h.Class('pane console')],
    [
      h.header([h.Class('pane-header')], ['Console']),
      AsyncData.matchDataSplitEmpty(model.console, {
        onIdle: () =>
          h.keyed('div')('Idle', [h.Class('console-idle')], ['Run some Forth to see output.']),
        onLoading: () =>
          h.keyed('div')('Loading', [h.Class('console-loading')], ['Running...']),
        onFailure: (error) =>
          h.keyed('div')('Failure', [h.Class('console-fault')], [`VM fault: ${error}`]),
        onData: (result) => h.keyed('div')('Data', [h.Class('console-data')], [outputView(result)]),
      }),
    ],
  )
}
