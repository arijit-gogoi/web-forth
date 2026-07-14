// §T.14/§T.15 update logic (pure), via foldkit's Story harness. Story drives `update`
// directly and asserts the resulting Model + emitted Commands, no DOM. This is where
// §V.5 (Forth error is Success data) and §V.13 (ignore run while pending) are
// machine-checkable.

import { AsyncData, Story } from 'foldkit'
import { expect, test } from 'vitest'
import { update } from './main'
import { init } from './model'
import {
  ClickedReset,
  ClickedRun,
  CompletedRun,
  FailedRun,
  PressedRun,
  UpdatedSource,
} from './message'
import { ResetVm, RunSource } from './run'

const initialModel = () => init()[0]

// A canned CompletedRun to resolve a pending run/reset Command in a pure story (Story
// does not execute Command effects; it folds the result Message you hand it).
const cannedCompleted = () =>
  CompletedRun({ result: { output: '', stack: [], throwCode: null }, dictionary: [] })

test('UpdatedSource replaces the editor source', () => {
  Story.story(
    update,
    Story.with(initialModel()),
    Story.message(UpdatedSource({ value: '1 2 +' })),
    Story.model((model) => {
      expect(model.source).toBe('1 2 +')
    }),
    Story.Command.expectNone(),
  )
})

test('ClickedRun moves the console to Loading and emits RunSource', () => {
  Story.story(
    update,
    Story.with({ ...initialModel(), source: '3 4 +' }),
    Story.message(ClickedRun()),
    Story.model((model) => {
      expect(model.console._tag).toBe('Loading')
    }),
    Story.Command.expectExact(RunSource({ source: '3 4 +' })),
    Story.Command.resolve(RunSource, cannedCompleted()),
  )
})

test('PressedRun (Ctrl+Enter) behaves like ClickedRun', () => {
  Story.story(
    update,
    Story.with({ ...initialModel(), source: '5 6 *' }),
    Story.message(PressedRun()),
    Story.Command.expectExact(RunSource({ source: '5 6 *' })),
    Story.Command.resolve(RunSource, cannedCompleted()),
  )
})

// §V.13: a run request while the console is pending is ignored. This is the
// discriminating proof of the invariant (the semaphore alone does not discriminate,
// since interpret is synchronous).
test('§V.13: ClickedRun while pending emits NO command and leaves the model', () => {
  const pendingModel = { ...initialModel(), console: AsyncData.Loading() }
  Story.story(
    update,
    Story.with(pendingModel),
    Story.message(ClickedRun()),
    Story.model((model) => {
      expect(model.console._tag).toBe('Loading')
    }),
    Story.Command.expectNone(),
  )
})

// §V.5: a completed run (even a Forth error) is Success; the throwCode rides in the data.
test('§V.5: CompletedRun with a non-null throwCode is Success, not Failure', () => {
  Story.story(
    update,
    Story.with(initialModel()),
    Story.message(
      CompletedRun({
        result: { output: 'foo ?\n', stack: [], throwCode: -13 },
        dictionary: [],
      }),
    ),
    Story.model((model) => {
      expect(model.console._tag).toBe('Success')
      if (model.console._tag === 'Success') {
        expect(model.console.data.throwCode).toBe(-13)
        expect(model.console.data.output).toBe('foo ?\n')
      }
    }),
    Story.Command.expectNone(),
  )
})

test('CompletedRun stores the stack + dictionary snapshots', () => {
  Story.story(
    update,
    Story.with(initialModel()),
    Story.message(
      CompletedRun({
        result: { output: '', stack: [1, 2, 3], throwCode: null },
        dictionary: [{ name: 'dup', immediate: false, hidden: false }],
      }),
    ),
    Story.model((model) => {
      expect(model.console._tag).toBe('Success')
      if (model.console._tag === 'Success') {
        expect(model.console.data.stack).toEqual([1, 2, 3])
      }
      expect(model.dictionary.some((word) => word.name === 'dup')).toBe(true)
    }),
  )
})

// A genuine VM fault is the E-channel case: FailedRun -> console Failure.
test('FailedRun sets the console to Failure', () => {
  Story.story(
    update,
    Story.with(initialModel()),
    Story.message(FailedRun({ error: 'simulated corruption' })),
    Story.model((model) => {
      expect(model.console._tag).toBe('Failure')
      if (model.console._tag === 'Failure') {
        expect(model.console.error).toBe('simulated corruption')
      }
    }),
  )
})

test('ClickedReset clears the console + dictionary and emits ResetVm', () => {
  const dirtyModel = {
    ...initialModel(),
    console: AsyncData.Success({
      data: { output: 'x', stack: [9], throwCode: null },
    }),
    dictionary: [{ name: 'foo', immediate: false, hidden: false }],
  }
  Story.story(
    update,
    Story.with(dirtyModel),
    Story.message(ClickedReset()),
    Story.model((model) => {
      expect(model.console._tag).toBe('Idle')
      expect(model.dictionary).toEqual([])
    }),
    Story.Command.expectExact(ResetVm({})),
    Story.Command.resolve(ResetVm, cannedCompleted()),
  )
})
