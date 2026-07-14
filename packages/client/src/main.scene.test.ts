// §T.14/§T.16-19 view, via foldkit's Scene harness. Scene renders {update,view} into
// happy-dom, drives real DOM events, and asserts the rendered output + the Commands and
// Mounts the interactions emit. It tracks OnMount as resolvable slots WITHOUT running the
// factory, so the CM6 EditorView is never constructed here (happy-dom cannot lay it out);
// the real editor is browser-verified. Every rendered mount must be resolved or the scene
// errors, so each test resolves MountEditor (§T.19).

import { Scene } from 'foldkit'
import { describe, test } from 'vitest'
import { update, view } from './main'
import { init } from './model'
import { CompletedRun, UpdatedSource } from './message'
import { RunSource } from './run'
import { MountEditor } from './view/mountEditor'

const initialModel = () => init()[0]

// A canned CompletedRun for resolving a pending run so the scene settles.
const cannedCompletedMessage = () =>
  CompletedRun({ result: { output: '15 ', stack: [], throwCode: null }, dictionary: [] })

// Resolve the always-present CM6 editor mount with a benign UpdatedSource (the factory is
// not run; this just clears the pending slot Scene requires to be resolved).
const resolveEditorMount = (model = initialModel()) =>
  Scene.Mount.resolve(MountEditor, UpdatedSource({ value: model.source }))

describe('three-pane layout', () => {
  test('renders editor, console, and inspector headers', () => {
    Scene.scene(
      { update, view },
      Scene.with(initialModel()),
      resolveEditorMount(),
      Scene.expect(Scene.text('Editor')).toExist(),
      Scene.expect(Scene.text('Console')).toExist(),
      Scene.expect(Scene.text('Data stack')).toExist(),
      Scene.expect(Scene.text('Dictionary')).toExist(),
    )
  })

  test('the run + reset buttons exist', () => {
    Scene.scene(
      { update, view },
      Scene.with(initialModel()),
      resolveEditorMount(),
      Scene.expect(Scene.role('button', { name: 'Run  (Ctrl+Enter)' })).toExist(),
      Scene.expect(Scene.role('button', { name: 'Reset' })).toExist(),
    )
  })
})

describe('CM6 editor mount (§T.19)', () => {
  test('the editor pane renders a MountEditor with the seed doc as initialDoc', () => {
    Scene.scene(
      { update, view },
      Scene.with(initialModel()),
      // The mount is present with the correct name + args (hostId, initialDoc). This is
      // the observable proof that the CM6 host is wired, without constructing the view.
      Scene.Mount.expectHas(
        MountEditor({ hostId: 'web-forth-editor', initialDoc: initialModel().source }),
      ),
      resolveEditorMount(),
    )
  })
})

describe('run wiring', () => {
  test('clicking Run emits RunSource with the model source', () => {
    Scene.scene(
      { update, view },
      Scene.with({ ...initialModel(), source: '7 8 +' }),
      resolveEditorMount({ ...initialModel(), source: '7 8 +' }),
      Scene.click(Scene.role('button', { name: 'Run  (Ctrl+Enter)' })),
      Scene.Command.expectExact(RunSource({ source: '7 8 +' })),
      Scene.Command.resolve(RunSource, cannedCompletedMessage()),
    )
  })
})
