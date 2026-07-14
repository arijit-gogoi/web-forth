// §T.14/§T.16/§T.17/§T.18 view, via foldkit's Scene harness. Scene renders {update,view}
// into happy-dom, drives real DOM events, and asserts both the rendered output and the
// Commands the interactions emit. This covers the three-pane layout and the editor/run
// wiring end to end (short of a live VM, which the Story/vm tests own).

import { Scene } from 'foldkit'
import { describe, test } from 'vitest'
import { update, view } from './main'
import { init } from './model'
import { CompletedRun } from './message'
import { RunSource } from './run'

const initialModel = () => init()[0]

// A canned CompletedRun for resolving a pending run so the scene settles.
const cannedCompletedMessage = () =>
  CompletedRun({ result: { output: '15 ', stack: [], throwCode: null }, dictionary: [] })

describe('three-pane layout', () => {
  test('renders editor, console, and inspector headers', () => {
    Scene.scene(
      { update, view },
      Scene.with(initialModel()),
      Scene.expect(Scene.text('Editor')).toExist(),
      Scene.expect(Scene.text('Console')).toExist(),
      Scene.expect(Scene.text('Data stack')).toExist(),
      Scene.expect(Scene.text('Dictionary')).toExist(),
    )
  })

  test('the run button exists', () => {
    Scene.scene(
      { update, view },
      Scene.with(initialModel()),
      Scene.expect(Scene.role('button', { name: 'Run  (Ctrl+Enter)' })).toExist(),
      Scene.expect(Scene.role('button', { name: 'Reset' })).toExist(),
    )
  })
})

describe('editor + run wiring', () => {
  test('typing into the editor and clicking Run emits RunSource with the typed source', () => {
    Scene.scene(
      { update, view },
      Scene.with({ ...initialModel(), source: '' }),
      Scene.type(Scene.role('textbox'), '7 8 +'),
      Scene.click(Scene.role('button', { name: 'Run  (Ctrl+Enter)' })),
      Scene.Command.expectExact(RunSource({ source: '7 8 +' })),
      Scene.Command.resolve(RunSource, cannedCompletedMessage()),
    )
  })
})
