# SPEC.md FORMAT

Single file. Project root. Every cavekit `/ck:*` command reads it. `SPEC.md` is the
sole source of truth; `/ck:spec` is its sole mutator (`/ck:build` only flips §T status).

## SECTIONS

Fixed order. Fixed headers. Addressable.

```
# SPEC

## §G GOAL

one line. what the system must be.

## §C CONSTRAINTS

- bullet. non-negotiable boundary.
- bullet. tech / lang / lib locked in.

## §I INTERFACES

external surface. what the world sees.
- app: `@web-forth/client` static SPA. 3 panes …
- cli: `web-forth` node REPL …
- lib: `@web-forth/engine` exports `class Forth`. `interpret(source): RunResult` …
- forth <tier> words: `dup drop swap …`

## §R RESEARCH

pipe table. external facts that shaped a decision, with a source.
id|topic|finding|src
R1|effect ver|foldkit peerDeps dictate effect ver|repos/foldkit/.../package.json

## §V INVARIANTS

numbered. testable. each ! MUST hold. never reuse a number.
V1: inner NEXT = single flat `while`; behavior routines ⊥ recurse into run()
V2: Effect ! only @ outer-interpreter boundary; engine ⊥ import effect | foldkit

## §T TASKS

pipe table. ids monotonic (never reused). status: `x` done / `~` wip / `.` todo.
id|status|task|cites
T1|.|scaffold pnpm workspace|C
T2|x|engine: ArrayBuffer mem + views + registers|V6,V7

## §B BUGS

pipe table. backprop log. each row = bug + the invariant that catches recurrence.
id|date|cause|fix
B1|2026-07-14|`ForthThrow` unwinds ⊥ run pending EXITs ∴ rsp dirty|V10
```

**Table cell rules**: literal `|` → escape as `\|`. Backticks OK. Cells trimmed. Empty = `-`.

## ADDRESSING

`§<S>.<n>` = section.item. `§V.17` = invariants section, item 17.
Commands, commits, PRs all reference by §. Zero ambiguity. Commit subject = `T<n>: <goal>`.

## SECTIONED OWNERSHIP

Each section has one owning cavekit skill; only `/ck:spec` writes the file.

| section | produced by | notes |
|---|---|---|
| §G, §C | `/ck:grill` | goal + constraints, sharpened from an idea |
| §I | `/ck:deepen` | interface surface |
| §R | `/ck:research` | external facts + source |
| §V | `/ck:review` | invariants that red-team the design |
| §T | `/ck:deepen` | task list; `/ck:build` flips status only |
| §B | `/ck:spec bug` | backprop, appends §B + a catching §V |

## CAVEMAN ENCODING

Default for every section. Rules:

- Drop articles (a, an, the). Drop filler.
- Drop aux verbs (is, are, was) where a fragment works.
- Short synonyms (fix > implement).
- Fragments fine.

**Preserve verbatim**: Forth words, code, paths, identifiers, URLs, numbers, error
strings / throw codes, cell layouts. A word like `>body` or `?do` is data, never prose.

**Symbols** (save tokens, machine-readable) — the set this SPEC uses:

```
→   leads to / becomes / triggers
∴   therefore / fix
∀   for all / every
∃   exists / some
∈   in / member of
∉   not in
!   must
?   may / optional
⊥   never / impossible / forbidden / not
≠   not equal / differs from
≤   at most
≥   at least
==  equals (value / identity)
·   times (cell math, e.g. CFA+2·CELL)
&   and
|   or
```

**Bad** (v1 prose):

> The inner interpreter's NEXT loop must be a single flat while loop, and behavior routines must never recurse back into run().

**Good** (v2 caveman):

> V1: inner NEXT = single flat `while`. behavior routines ⊥ recurse into `run()`.

**Bad** (prose bug note):

> Fixed a bug where a ForthThrow unwound the JS stack without running the pending EXITs, leaving the return-stack pointer dirty mid-colon so the next interpret() misbehaved.

**Good** (v2 caveman):

> B1: `ForthThrow` unwinds JS stack ⊥ run pending `EXIT`s ∴ `rsp` dirty mid-colon → next `interpret()` misbehaves. §V.10 now ! abort reset dsp+rsp+running.

## WHY CAVEMAN FOR SPECS

Spec loaded every invocation. ~75% fewer tokens = fewer dollars & faster reads.
Human skims fast too. Symbols unambiguous.

## ONE FILE RULE

Big project → more sections, not more files. grep ceremony kills agent speed.
If SPEC.md > 500 lines, compact §B (drop oldest bugs) before splitting.

## WRITES

| command | writes | section |
|---|---|---|
| `/ck:spec` new | creates | all |
| `/ck:spec` amend | edits | chosen |
| `/ck:spec` bug | appends | §B + §V |
| `/ck:build` | flips | §T status cell `.` → `~` → `x` |
| `/ck:review` | — | read only (drafts §V for spec) |

That is the whole format.
