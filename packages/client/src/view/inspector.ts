// @web-forth/client inspector pane (SPEC.md §T.17, §V.3, §V.4). Two read-only snapshot
// views: the data stack (from the latest run's RunData) and the dictionary (a copied
// WordEntry array in the Model). Both are copies, never the live VM structures (§V.4).

import { Array as Arr, Option } from 'effect'
import { AsyncData } from 'foldkit'
import { html } from 'foldkit/html'
import type { Html } from 'foldkit/html'
import type { Model } from '../model'
import type { Message, WordEntry } from '../message'

const stackView = (model: Model): Html => {
  const h = html<Message>()
  const maybeStack = Option.map(AsyncData.getData(model.console), (result) => result.stack)
  const stack = Option.getOrElse(maybeStack, () => [] as ReadonlyArray<number>)

  return Arr.match(stack, {
    onEmpty: () => h.div([h.Class('stack-empty')], ['(empty)']),
    onNonEmpty: (values) =>
      h.ul(
        [h.Class('stack-list')],
        // Top of stack first, keyed by depth position (stable identity, not value).
        Arr.reverse(values).map((value, indexFromTop) =>
          h.keyed('li')(
            `depth-${values.length - 1 - indexFromTop}`,
            [h.Class('stack-item')],
            [value.toString()],
          ),
        ),
      ),
  })
}

const dictionaryView = (model: Model): Html => {
  const h = html<Message>()

  return Arr.match(model.dictionary, {
    onEmpty: () => h.div([h.Class('dict-empty')], ['(run to populate)']),
    onNonEmpty: (words) =>
      h.ul(
        [h.Class('dict-list')],
        words
          .filter((word) => !word.hidden)
          .map((word: WordEntry) =>
            h.keyed('li')(
              word.name,
              [h.Class(word.immediate ? 'dict-item dict-immediate' : 'dict-item')],
              [word.name],
            ),
          ),
      ),
  })
}

export const inspectorPaneView = (model: Model): Html => {
  const h = html<Message>()

  return h.aside(
    [h.Class('pane inspector')],
    [
      h.header([h.Class('pane-header')], ['Data stack']),
      stackView(model),
      h.header([h.Class('pane-header')], ['Dictionary']),
      dictionaryView(model),
    ],
  )
}
