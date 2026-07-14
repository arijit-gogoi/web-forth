// @web-forth/client Messages (SPEC.md §T.14). Verb-first, past-tense facts (foldkit
// idiom). Defined once, whole union up front, so the RunSource Command (§T.15) and the
// update (§T.14-18) share constructors without a Command<->main circular import.
//
// Channel model (§V.5): CompletedRun is the ACK for every ordinary run, INCLUDING a
// Forth error. The throwCode rides inside its payload and the error text is already in
// output. FailedRun fires only on a genuine ForthFault (near-never). So a Forth error is
// AsyncData.Success, not Failure.

import { Schema as S } from 'effect'
import { m } from 'foldkit/message'

// The data a completed run yields into the console. A copy of the VM's post-run state
// (§V.4): output text, the data-stack snapshot, and the throw code (null on success,
// negative Forth code on an ordinary error).
export const RunData = S.Struct({
  output: S.String,
  stack: S.Array(S.Number),
  throwCode: S.NullOr(S.Number),
})
export type RunData = typeof RunData.Type

// One dictionary entry for the inspector pane (Schema mirror of engine WordInfo).
export const WordEntry = S.Struct({
  name: S.String,
  immediate: S.Boolean,
  hidden: S.Boolean,
})
export type WordEntry = typeof WordEntry.Type

// Editor text changed (textarea OnInput in v1; the CM6 stream in v2 feeds the same fact).
export const UpdatedSource = m('UpdatedSource', { value: S.String })
// Run requested via the button.
export const ClickedRun = m('ClickedRun')
// Run requested via Ctrl+Enter in the editor. A distinct fact from ClickedRun, same
// effect (foldkit forbids NoOp-style sharing; the origin is meaningful).
export const PressedRun = m('PressedRun')
// Reset requested via the button: clear the VM and the console.
export const ClickedReset = m('ClickedReset')

// A run finished and carries its result data (rides the success channel, §V.5).
export const CompletedRun = m('CompletedRun', {
  result: RunData,
  dictionary: S.Array(WordEntry),
})
// A run hit a genuine VM fault (ForthFault). Rare; the E-channel case of RunSource.
export const FailedRun = m('FailedRun', { error: S.String })

export const Message = S.Union([
  UpdatedSource,
  ClickedRun,
  PressedRun,
  ClickedReset,
  CompletedRun,
  FailedRun,
])
export type Message = typeof Message.Type
