# Foldkit patterns reference (for web-forth)

Code-grounded extraction of Foldkit patterns from vendored source, feeding the web-forth spec.

- Source root (read-only): `repos/foldkit/`
- Foldkit version: `0.128.0` (`packages/foldkit/package.json:3`)
- Peer deps: `effect@4.0.0-beta.88`, `@effect/platform-browser@4.0.0-beta.88` (`packages/foldkit/package.json:160`)

Every API claim below cites a real `path:line` under `repos/foldkit/`. Paths are relative to that root. Conventions followed: Schema-typed Model, full names (`Message`, not `Msg`), `Array<T>` (never `T[]`), no bracket indexing, `Match` over `switch`, no em dashes.

## The one throughline that governs web-forth

Both the CodeMirror `EditorView` and the Forth `Vm` are **mutable, non-Schema handles**. Neither may live in the Schema Model. They live outside it, and only Schema-typed **snapshots** cross back into the Model via Messages.

- `EditorView` (mutable DOM widget) lives in a **module-level registry keyed by a host id**, bridged in by a Mount. The Model holds only `Option<hostId>`. This is exactly what the `map` example does with maplibre (`examples/map/src/mapHost.ts:9`).
- `Vm` (mutable `Int32Array` core) lives as an **Effect service** provided app-wide via `resources: Layer.Layer<Vm>` (`packages/foldkit/src/runtime/runtime.ts:717`). Commands receive it in the Effect `R` channel (`Command<Message, never, Resources>`, `packages/foldkit/src/command/index.ts:13`).
- The RunSource result Message carries a **copy** of the data-stack slice as `ReadonlyArray<number>`, never the live `Int32Array`. Same rule as "keep the mutable instance out of the Model."

---

## A. Minimal app skeleton (from `examples/counter/`)

Two files: `main.ts` (Model / Message / init / update / view) and `entry.ts` (bootstrap). The `index.html` has `<div id="root"></div>` and loads `entry.ts` (`examples/counter/index.html:10`).

Subpath exports used (all from the `foldkit` package; see the barrel `packages/foldkit/src/index.ts:1` and `exports` map `packages/foldkit/package.json:9`):

- `foldkit` -> `Runtime`, `Command`, `Mount`, `Subscription`, `ManagedResource`, ...
- `foldkit/html` -> `html`, `Document`, `Html`, `Attribute`
- `foldkit/message` -> `m` (Message constructor)
- `foldkit/schema` -> `ts` (tagged-struct constructor), `S`
- `foldkit/struct` -> `evo` (immutable Model update)

**Model** is a Schema struct; the type is derived (`examples/counter/src/main.ts:10`):

```ts
export const Model = S.Struct({ count: S.Number })
export type Model = typeof Model.Type
```

**Message** is a Schema union of `m(...)` constructors (`examples/counter/src/main.ts:15`):

```ts
export const ClickedDecrement = m('ClickedDecrement')
export const Message = S.Union([ClickedDecrement, ClickedIncrement, ClickedReset])
export type Message = typeof Message.Type
```

**update** returns `readonly [Model, ReadonlyArray<Command.Command<Message>>]`, dispatched with `Match` (`examples/counter/src/main.ts:28`). The second tuple slot is the Commands to run; `[]` means none:

```ts
export const update = (model: Model, message: Message):
  readonly [Model, ReadonlyArray<Command.Command<Message>>] =>
  M.value(message).pipe(
    M.withReturnType<readonly [Model, ReadonlyArray<Command.Command<Message>>]>(),
    M.tagsExhaustive({
      ClickedIncrement: () => [{ count: model.count + 1 }, []],
      // ...
    }),
  )
```

**init** has type `Runtime.ApplicationInit<Model, Message>` and returns the same `[Model, Commands]` tuple (`examples/counter/src/main.ts:45`; type at `packages/foldkit/src/runtime/runtime.ts:908`). Boot-time Commands go in the array (the `map` app seeds `[FocusSearchInput()]`, `examples/map/src/main.ts:342`).

**view** returns a `Document` (`{ title, body }`, `packages/foldkit/src/html/index.ts:139`). Get the element factory with `const h = html<Message>()` (`examples/counter/src/main.ts:53`).

**Bootstrap** (`examples/counter/src/entry.ts:7`): `Runtime.makeApplication(config)` builds the program, `Runtime.run(program)` boots it via the browser runtime.

```ts
import { Runtime } from 'foldkit'
import { Message, Model, init, update, view } from './main'

const application = Runtime.makeApplication({
  Model, init, update, view,
  container: document.getElementById('root'),
})
Runtime.run(application)
```

- `makeApplication` signature: `packages/foldkit/src/runtime/runtime.ts:2707` (no-flags, no-routing overload). Config shape `BaseApplicationConfig` at `packages/foldkit/src/runtime/runtime.ts:690`: `Model`, `update`, `view`, `subscriptions?`, `container: HTMLElement | null`, `resources?: Layer.Layer<Resources>`, `managedResources?`, `devTools?`.
- `run`: `packages/foldkit/src/runtime/runtime.ts:3165` (`BrowserRuntime.runMain`).
- **`makeApplication` view returns `Document` and owns `<head>`/title.** If web-forth is embedded as one pane inside a larger host page, use `makeElement` instead (`packages/foldkit/src/runtime/runtime.ts:2931`); its view returns `Html` and never touches `<head>` (`packages/foldkit/src/html/index.ts:139`, note on `Document`). Default to `makeApplication` for a standalone app.

---

## B. Command pattern: async side effect folds into Messages (from `examples/weather/`)

A Command is a named Effect that resolves to a result Message. Build one with `Command.define(name, argsSchema?, ...ResultSchemas)(effectBuilder)` (signature `packages/foldkit/src/command/index.ts:111`; two overloads, args form at `:121`).

Success and failure both become declared Messages. The failure fold uses `Effect.catch` so a side effect never crashes the app (`examples/weather/src/main.ts:217`):

```ts
export const fetchWeatherEffect = (zipCode: string) =>
  Effect.gen(function* () {
    // ... may Effect.fail(FailedFetchWeather({ error }))
    return SucceededFetchWeather({ weather })
  }).pipe(
    Effect.catchTag('FailedFetchWeather', error => Effect.succeed(error)),
    Effect.catch(() =>
      Effect.succeed(FailedFetchWeather({ error: 'Failed to fetch weather data' })),
    ),
  )

export const FetchWeather = Command.define(
  'FetchWeather',
  { zipCode: S.String },        // args schema
  SucceededFetchWeather,        // result Message schemas (>= 1 required)
  FailedFetchWeather,
)(({ zipCode }) => Effect.provide(fetchWeatherEffect(zipCode), Http.layer))
```

`update` returns the Command in the tuple's second slot; the runtime runs it and feeds the produced Message back through `update` (`examples/weather/src/main.ts:66`):

```ts
SubmittedWeatherForm: () => {
  if (AsyncData.isPending(model.weather)) { return [model, []] }
  return [
    evo(model, { weather: () => WeatherAsyncData.Loading() }),
    [FetchWeather({ zipCode: model.zipCodeInput })],
  ]
},
SucceededFetchWeather: ({ weather }) =>
  [evo(model, { weather: () => WeatherAsyncData.Success({ data: weather }) }), []],
FailedFetchWeather: ({ error }) =>
  [evo(model, { weather: () => WeatherAsyncData.Failure({ error }) }), []],
```

Naming (per `repos/foldkit/CLAUDE.md`): `Succeeded*`/`Failed*` when failure is meaningful; `Completed*` for fire-and-forget acks that `update` no-ops on (see `LockBodyScroll` -> `CompletedLockBodyScroll`, `examples/map/src/main.ts:210`). `AsyncData` models the Idle/Loading/Success/Failure lifecycle in the Model (`examples/weather/src/main.ts:23`); web-forth's console output should use the same shape.

This is the model for web-forth's **RunSource** (see the recommendation section).

---

## C. Imperative third-party widget bridge (CodeMirror) THE key question

**Authoritative rule** (`repos/foldkit/CLAUDE.md`, "Choosing Lifecycle Primitives"), quoted verbatim:

> An element exists in the rendered tree, and the factory uses the element to do DOM work? Mount. Use `Mount.define` for one-shot acquire-with-cleanup, `Mount.defineStream` for continuous events from listeners or observers. Both require at least one declared result Message.

> If a Mount factory doesn't read or write its element, you've misidentified the cause. Mount args are captured at mount, not refreshed across renders.

The four candidates, and why Mount wins:

| Primitive | Cause it models | Fit for CodeMirror |
| --- | --- | --- |
| **Mount** (`Mount.define` / `Mount.defineStream`) | An element exists in the rendered tree and the factory uses that element to do DOM work, with lifetime tied to the element. | **Yes.** CodeMirror needs the live mount node, an init call, an onChange event stream, and teardown on unmount. Exactly this. |
| **ManagedResource** | Model condition plus Commands need a stateful handle; acquire/release keyed on a Model-derived requirements value. | Overkill and mis-cued. It is Model-driven, not element-driven; it has no mount node. Use it for a WebSocket or camera, not a DOM widget. (`packages/foldkit/src/managedResource/managedResource.ts:185`) |
| **CustomElement** | Rendering a native Web Component (`customElements.define`). | Only if you first wrap CodeMirror in a real `<custom-element>`. An extra indirection with no benefit here. (`packages/foldkit/src/customElement/public.ts:1`) |
| **port** | Talking to code outside the Foldkit runtime (host page, JS interop) over inbound/outbound channels. | Not a DOM-widget primitive; it is a message boundary. (`packages/foldkit/src/port/public.ts:1`) |

**Discriminator between the two Mount forms** (this is the crux):

- `Mount.defineStream` when events are wired **at construction** and fire continuously. CodeMirror's `EditorView` takes an `updateListener` extension at construction that fires on **every keystroke**. That is a continuum from a listener attached to the element, so `defineStream` folds init + event-stream + cleanup into a single primitive. Signature: `packages/foldkit/src/mount/index.ts:380` (args form at `:392`). The idiomatic body mirrors the `SyncSidebarScroll` scroll-listener and `IntersectionObserver` examples in its own TSDoc (`packages/foldkit/src/mount/index.ts:311` and `:340`): `Stream.callback` -> `Effect.acquireRelease`(construct the widget with a listener that `Queue.offerUnsafe`s a Message; release destroys it) -> `Effect.never`.

- `Mount.define` (one-shot `Effect<Message>` + cleanup) when the library attaches events **post-construction** and Commands drive it. This is what `map` does: construct maplibre, then `map.on('moveend', ...)` is wired **later** in a separate `Subscription` gated on the host id, and Commands (`FlyTo`) reach the instance to drive it. Signature: `packages/foldkit/src/mount/index.ts:210`.

web-forth's editor (decided: CodeMirror 6) should use **`defineStream`**: CM6's `updateListener` and `keymap` are construction-time extensions on the mount node. The `map` pattern (`define` + `Subscription`) is the documented alternative for the post-construction-events shape. Concrete CM6 sketch is in the Recommendation section below.

**The registry bridge (needed either way).** The mutable instance never enters the Model. Stash it in a module-level `Map` keyed by host id so Commands and Subscriptions can reach it (`examples/map/src/mapHost.ts:9`):

```ts
// mapHost.ts pattern, applied to CodeMirror as editorHost.ts
const mapsByHostId = new Map<string, MapInstance>()
export const setMap = (hostId: string, instance: MapInstance): void => { mapsByHostId.set(hostId, instance) }
export const getMap = (hostId: string): Option.Option<MapInstance> => Option.fromNullishOr(mapsByHostId.get(hostId))
export const removeMap = (hostId: string): void => Option.match(getMap(hostId), {
  onNone: Function.constVoid,
  onSome: map => { map.remove(); mapsByHostId.delete(hostId) },
})
```

**Full end-to-end template** (`map` is the closest vendored analog to CodeMirror; it uses `Mount.define`, but the acquire/release + registry + Model-holds-only-`Option<hostId>` structure is identical for `defineStream`). Mount definition (`examples/map/src/main.ts:347`):

```ts
export const MountMap = Mount.define('MountMap', { hostId: S.String }, SucceededMountMap, FailedMountMap)(
  ({ hostId }) => element =>
    Effect.gen(function* () {
      if (!(element instanceof HTMLElement)) { return FailedMountMap({ reason: '...' }) }
      return yield* Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.gen(function* () {
            const maplibre = yield* Effect.tryPromise(() => import('maplibre-gl'))  // dynamic import inside acquire
            const map = new maplibre.Map({ container: element, /* ... */ })
            setMap(hostId, map)             // stash in registry
            return map
          }),
          () => Effect.sync(() => removeMap(hostId)),   // teardown on unmount
        )
        return SucceededMountMap({ hostId })
      }).pipe(Effect.catch(error => Effect.succeed(FailedMountMap({ reason: String(error) }))))
    }),
)
```

Attached in the view via `h.OnMount(...)` on the host div (`examples/map/src/main.ts:662`):

```ts
h.div([h.Class('h-full w-full'), h.OnMount(MountMap({ hostId: HOST_ID }))], [])
```

The Model holds only `maybeMapHostId: S.Option(S.String)` (`examples/map/src/main.ts:62`); the `SucceededMount*` Message stores the id (`examples/map/src/main.ts:245`); Commands read the live instance from the registry to drive it (`FlyTo` -> `getMap(hostId)`, `examples/map/src/main.ts:113`).

**Critical constraint: Mount args are captured at mount, not refreshed across renders** (`packages/foldkit/src/mount/index.ts:187`). So a seed value passed as an arg is the value at insert time only. Name the editor's seed arg `initialDoc`, never `currentDoc`. Ongoing document changes flow through the registry via Commands (a "load example" Command writes into the live `EditorView`), not through re-mounting.

Note on citation scope: the Foldkit-side primitives above and in the Recommendation are all citable at the noted `path:line`. The CM6-side calls (`EditorState.create`, `new EditorView`, `updateListener`, `keymap`, `view.dispatch`, `.destroy()`) are reasoned from the CM6 public API; CM6 is being vendored to `repos/codemirror/{state,view,commands,language}` in parallel but is not cited here.

---

## D. Plain text-input path (v1 fallback, from `examples/form/`)

Before CodeMirror, a `<textarea>` is the whole editor. Value change -> Message -> Model. Two attributes do it:

- `h.Value(string)` sets the controlled value (attribute enum `Value` at `packages/foldkit/src/html/index.ts:548`).
- `h.OnInput((value: string) => Message)` fires per keystroke; the handler reads `event.target.value` for you and dispatches (`packages/foldkit/src/html/index.ts:505`, wiring at `:1465`). `h.OnChange` is the same but on the DOM `change` event (blur/commit) (`:506`).

Form example wiring (`examples/form/src/main.ts:210` for the handler, `:412` for the textarea element):

```ts
UpdatedMessageText: ({ value }) => [evo(model, { messageText: () => Valid({ value }) }), []],
// view:
h.textarea([...attributes.textarea, h.Class(inputClassName(field))], [])
```

Minimal web-forth v1 editor:

```ts
export const UpdatedSource = m('UpdatedSource', { value: S.String })
// Model: { source: S.String, ... }
// update:
UpdatedSource: ({ value }) => [evo(model, { source: () => value }), []],
// view:
h.textarea(
  [h.Value(model.source), h.OnInput(value => UpdatedSource({ value })),
   h.Class('w-full h-full font-mono'), h.Spellcheck(false)],
  [],
)
```

Here `model.source` is a real value, so `S.String` (not `Option`) is correct; an empty editor is `''`, an actual value, per the state-modeling rule in `repos/foldkit/CLAUDE.md`.

---

## E. Keyboard / timer Subscription (from `examples/stopwatch/`, keyboard from `foldkit/html`)

A `Subscription` streams external events, gated by a Model-derived dependency. Build with `Subscription.make<Model, Message>()(entry => ({ ... }))` (signature `packages/foldkit/src/subscription/subscription.ts:166`). Each entry declares a dependency schema, `modelToDependencies`, and `dependenciesToStream`. The stream is torn down and rebuilt when the dependency changes.

Interval gated by Model (`examples/stopwatch/src/main.ts:144`):

```ts
export const subscriptions = Subscription.make<Model, Message>()(entry => ({
  tick: entry(
    { isRunning: S.Boolean },
    {
      modelToDependencies: model => ({ isRunning: model.isRunning }),
      dependenciesToStream: ({ isRunning }) =>
        Stream.when(
          Stream.tick(Duration.millis(TICK_INTERVAL_MS)).pipe(Stream.map(Ticked)),
          Effect.sync(() => isRunning),
        ),
    },
  ),
}))
```

Register it by adding `subscriptions` to the `makeApplication` config (`packages/foldkit/src/runtime/runtime.ts:706`).

**Keyboard.** Two paths:

1. Per-element handler in the view: `h.OnKeyDown((key, modifiers) => Message)` where `modifiers` is `{ shiftKey, ctrlKey, altKey, metaKey }` (attribute at `packages/foldkit/src/html/index.ts:476`, `KeyboardModifiers` at `:107`). For "Ctrl+Enter runs" scoped to the editor pane, `h.OnKeyDownPreventDefault((key, modifiers) => key === 'Enter' && modifiers.ctrlKey ? Option.some(ClickedRun()) : Option.none())` returns an `Option` so non-matching keys pass through and matching keys `preventDefault` (`:479`, wiring at `:1392`).
2. Global document keydown as a Subscription: `Subscription.fromEvent` / `fromEventFilterMap` (`packages/foldkit/src/subscription/public.ts:17`) for shortcuts that must fire regardless of focus. Gate it on a Model flag (for example, only while the console is focused) via `modelToDependencies`.

For web-forth, prefer the per-element `OnKeyDown` on the editor for Ctrl+Enter (it is naturally scoped to editor focus); reserve a global Subscription for app-wide shortcuts.

---

## F. View DSL basics (`foldkit/html`)

`const h = html<Message>()` returns a process-wide factory (`packages/foldkit/src/html/index.ts:4979`) that mixes element constructors, attribute constructors, `keyed`, `empty`, and `submodel` (`:4958`).

- **Elements**: `h.div(attributes, children)`, `h.button(...)`, `h.textarea(...)`, `h.ul`, `h.li`, `h.pre`, `h.code`, `h.span`, `h.section`, `h.aside`, `h.main`, `h.header`, ... one per tag in `TagName` (`packages/foldkit/src/html/index.ts:147`; every tag web-forth needs, including `pre`, `code`, `table`, `tbody`, `tr`, `td`, exists there). Signature is `(attributes: Array<Attribute>, children: Array<Html | string>)`.
- **Text**: a plain string in the children array is a text node (`examples/counter/src/main.ts:66`, `[model.count.toString()]`).
- **Attributes**: capitalized constructors. `h.Class(str)`, `h.Id(str)`, `h.Style(record)`, `h.Value(str)`, `h.Disabled(bool)`, `h.Placeholder(str)`, `h.Spellcheck(bool)`, `h.AriaLabel(str)`, `h.DataAttribute(key, value)`, `h.Attribute(key, value)` (all in the factory at `packages/foldkit/src/html/index.ts:4700`+; full `Attribute` enum at `:420`).
- **Event handlers**: `h.OnClick(Message)`, `h.OnInput(value => Message)`, `h.OnChange(value => Message)`, `h.OnSubmit(Message)`, `h.OnKeyDown((key, mods) => Message)`, `h.OnMount(mountAction)`, `h.OnUnmount(Message)` (enum at `:437`+; `OnMount`/`OnUnmount` at `:779`).
- **Lists**: build the children array with `Array.map`; use `Array.match` to branch empty vs non-empty (`examples/map/src/main.ts:556`). Key each mapped item by a stable model id, never array index (rule in `repos/foldkit/CLAUDE.md`, "Key mapped list items by a stable model identifier").
- **`empty`**: `h.empty` renders nothing (it is `null`, `:4961`); use it for the `onNone`/absent branch (`examples/map/src/main.ts:641`).
- **`keyed` (required for branching views)**: `h.keyed(tagName)(key, attributes, children)` (`:4962`). **Whenever a DOM position renders different content based on a tagged union (route tag, model variant, Match, if/else, ternary), wrap each branch in a single `keyed` element with a discriminating key.** One key per branch, never shared. **Keys carry identity, not data**: never derive a key from displayed content, because a data-derived key tears down live DOM (focus, scroll, selection) on every change. Example, one key per AsyncData branch (`examples/weather/src/main.ts:294`):

```ts
AsyncData.matchDataSplitEmpty(model.weather, {
  onIdle: () => h.empty,
  onLoading: () => h.keyed('div')('Loading', [/* attrs */], ['Fetching weather...']),
  onFailure: error => h.keyed('div')('Failure', [/* attrs */], [error]),
  onData: weather => h.keyed('div')('Success', [/* attrs */], [weatherView(weather)]),
})
```

**3-pane layout (editor | console | stack+dict).** The three panes are stable siblings, so no per-pane key. A flex row of three columns, mirroring the `map` app's sidebar + map split (`examples/map/src/main.ts:499`):

```ts
h.div([h.Class('h-screen w-screen flex')], [
  editorPaneView(model),      // left: textarea (v1) or CodeMirror host div (v2)
  consolePaneView(model),     // middle: output log
  inspectorPaneView(model),   // right: data stack + dictionary
])
```

Within a pane, key each branch that swaps on a union: the console (Idle | Running | Ok | Error) and the editor (textarea-v1 vs CodeMirror) each wrap their branches in `keyed`, one key per branch, keys carrying identity (which editor, which console state) and never the source text or output.

---

## web-forth mapping

| web-forth UI need | Foldkit primitive | Cite |
| --- | --- | --- |
| App bootstrap / mount to DOM | `Runtime.makeApplication(config)` + `Runtime.run` (view returns `Document`); `makeElement` if embedded as a pane (view returns `Html`) | `runtime.ts:2707`, `:3165`, `:2931` |
| Forth `Vm` (mutable core) | Effect service via `resources: Layer.Layer<Vm>`; Commands get it in the `R` channel | `runtime.ts:717`, `command/index.ts:13` |
| Editor pane (CodeMirror 6) | `Mount.defineStream` (construction-time `updateListener` + `keymap` -> Message stream) + module registry for the `EditorView`; push content via `view.dispatch({ changes })` Command | `mount/index.ts:380`, `map/src/mapHost.ts:9`, `map/src/main.ts:113` |
| Editor pane (v1 fallback) | `h.textarea` with `h.Value` + `h.OnInput` | `html/index.ts:548`, `:505`; `form/src/main.ts:412` |
| Run source | `Command.define(...)` reading the `Vm` service; `Succeeded/FailedRun` fold via `Effect.catch` | `command/index.ts:111`; `weather/src/main.ts:225`, `:217` |
| Console output pane | Model field as `AsyncData` (Idle/Running/Ok/Error); render with `keyed` per branch | `weather/src/main.ts:23`, `:294` |
| Data-stack view | `h.ul`/`h.pre` over `ReadonlyArray<number>` snapshot in Model; key items by stable index-identity or render as one `pre` | `map/src/main.ts:556` |
| Dictionary view | `h.ul` over `Array.map` of word entries, keyed by word name | `map/src/main.ts:556` |
| Ctrl+Enter runs | `h.OnKeyDownPreventDefault` on the editor pane (scoped to focus) | `html/index.ts:479` |
| App-wide shortcut / focus-gated key | `Subscription.fromEvent` gated on a Model flag | `subscription/public.ts:17`, `subscription.ts:166` |
| Live-instance access from Commands | module registry keyed by host id (`getEditor(hostId)`) | `map/src/mapHost.ts:13` |

## Recommendation

**Editor pane: CodeMirror 6 via `Mount.defineStream`, with a textarea-only v1 fallback.**

Editor is decided: CodeMirror 6 (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`). CM6 is itself TEA-shaped (immutable `EditorState`, changes applied as transactions, `EditorView` is a projection of state), so it slots cleanly into Foldkit: the `EditorView` is the only mutable, non-Schema handle, it stays in the module registry, and both document edits and a Mod-Enter keymap emit Messages through the same stream.

**Primitive choice: `Mount.defineStream`.** CM6's `EditorView.updateListener.of(...)` and any `keymap.of([...])` are extensions wired **at construction** on the mount element and fire continuously (every keystroke, every run keypress). That is precisely the case the authoritative rule assigns to `defineStream` ("continuous events from listeners or observers", `repos/foldkit/CLAUDE.md`), and it matches the `SyncSidebarScroll` listener example in that constructor's own TSDoc (`packages/foldkit/src/mount/index.ts:311`). `Mount.define` + a `Subscription` (the `map` app's split, `examples/map/src/main.ts:347` + `:457`) is the documented alternative for libraries that attach events post-construction via `.on(...)`; CM6 does not, so `defineStream` is the tighter fit. `ManagedResource` (Model-driven, no mount node, `packages/foldkit/src/managedResource/managedResource.ts:185`) and `CustomElement` (native Web Component, `packages/foldkit/src/customElement/public.ts:1`) are both wrong for a DOM-editor-on-a-mount-node.

CM6-specific sketch (Foldkit-side citable at the noted lines; CM6-side reasoned from CM6 API):

```ts
export const MountEditor = Mount.defineStream(          // packages/foldkit/src/mount/index.ts:380
  'MountEditor',
  { hostId: S.String, initialDoc: S.String },           // captured at mount, hence initialDoc not currentDoc
  ChangedSource, PressedRun,                             // >= 1 result Message (union of both)
)(({ hostId, initialDoc }) => element =>
  Stream.callback<typeof ChangedSource.Type | typeof PressedRun.Type>(queue =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        const { EditorState } = yield* Effect.tryPromise(() => import('@codemirror/state'))
        const { EditorView, keymap } = yield* Effect.tryPromise(() => import('@codemirror/view'))
        const state = EditorState.create({
          doc: initialDoc,
          extensions: [
            keymap.of([{ key: 'Mod-Enter', run: () => { Queue.offerUnsafe(queue, PressedRun()); return true } }]),
            EditorView.updateListener.of(update => {
              if (update.docChanged) {
                Queue.offerUnsafe(queue, ChangedSource({ value: update.state.doc.toString() }))
              }
            }),
          ],
        })
        const view = new EditorView({ state, parent: element })   // element is the mount node
        setEditor(hostId, view)                                    // registry, out of the Model
        return view
      }),
      view => Effect.sync(() => { removeEditor(hostId); view.destroy() }),   // teardown on unmount
    ).pipe(Effect.flatMap(() => Effect.never)),
  ),
)
```

Model holds `maybeEditorHostId: S.Option(S.String)`. View: `h.div([h.OnMount(MountEditor({ hostId: EDITOR_HOST, initialDoc: '' }))], [])` (`examples/map/src/main.ts:662`). Because the Mod-Enter keymap is inside CM6, `PressedRun` fires with editor focus and needs no separate `h.OnKeyDown`.

**Pushing content in (load example / clear).** External writes go through a Command that finds the live view in the registry and dispatches a CM6 transaction, never through re-mount (args are captured at mount, `packages/foldkit/src/mount/index.ts:187`):

```ts
export const LoadExample = Command.define('LoadExample', { hostId: S.Option(S.String), source: S.String }, CompletedLoadExample)(
  ({ hostId, source }) => Option.match(hostId, {
    onNone: () => Effect.succeed(CompletedLoadExample()),
    onSome: id => Option.match(getEditor(id), {
      onNone: () => Effect.succeed(CompletedLoadExample()),
      onSome: view => Effect.sync(() => {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } })   // CM6 transaction
        return CompletedLoadExample()
      }),
    }),
  }),
)
```

This is the same registry-access shape the `map` app's `FlyTo` uses to drive the live instance (`examples/map/src/main.ts:113`).

**v1 fallback**: the `h.textarea` in section D. Ship this first; swap the editor pane's branch (keyed) to the Mount host div when adding CM6. Nothing else in the architecture changes, because the textarea feeds `UpdatedSource` and CM6 feeds the same `ChangedSource` fact, and Ctrl+Enter is `h.OnKeyDownPreventDefault` in v1, the CM6 keymap in v2.

**RunSource Command shape.** A Command that reads the `Vm` service, runs the current source, and returns a snapshot Message. The `Vm` is provided app-wide via `resources`, so it is in the `R` channel; success and failure fold via `Effect.catch` (`weather/src/main.ts:217`):

```ts
export const CompletedRun = m('CompletedRun', {
  output: S.String,
  stack: S.Array(S.Number),          // COPY of the Int32Array slice, never the live buffer
})
export const FailedRun = m('FailedRun', { error: S.String })

export const RunSource = Command.define('RunSource', { source: S.String }, CompletedRun, FailedRun)(
  ({ source }) =>
    Effect.gen(function* () {
      const vm = yield* Vm                          // Effect service from resources Layer
      const output = yield* vm.interpret(source)    // drives the mutable Int32Array core
      const stack = yield* vm.stackSnapshot          // returns ReadonlyArray<number>, a copy
      return CompletedRun({ output, stack })
    }).pipe(
      Effect.catch(error => Effect.succeed(FailedRun({ error: String(error) }))),
    ),
)
```

`update` for `ClickedRun` returns `[modelWithConsoleLoading, [RunSource({ source: model.source })]]`; `CompletedRun` writes `output` + `stack` into the Model as `AsyncData.Success`; `FailedRun` writes `AsyncData.Failure`. The stack in the Model is a plain `ReadonlyArray<number>` copied out of the VM, satisfying the "snapshots cross, mutable handles do not" throughline.

**Console output, data-stack, dictionary views.** Console: a Model field typed as `AsyncData` (Idle | Loading | Ok | Error), rendered with one `keyed` branch per state (section F, `weather/src/main.ts:294`), each key an identity string, never the output text. Data stack: render the `ReadonlyArray<number>` snapshot as a single `h.pre`, or an `h.ul` keyed by stable position-identity. Dictionary: `h.ul` over `Array.map` of word entries, keyed by word name.

**Bootstrap/main call.** `Runtime.makeApplication({ Model, init, update, view, subscriptions, container: document.getElementById('root'), resources: VmLayer })` then `Runtime.run(application)` (section A; `resources` field at `runtime.ts:717`). Split into `main.ts` (Model/Message/init/update/view/Commands) and `entry.ts` (the `makeApplication` + `run`), per the counter layout.
