# The Epic Map and the plan: what is next

Where the Epic Map stands after phases 5–9, and what to build next.

The research behind the last phase is in `reports/AI assisted roadmap planning.md` (87 sourced links; the raw notes are not in the repo).

**There is a second analysis** in `docs/ai-planning-and-voice.md`: what to do about the Gantt, an AI that drafts a whole plan, voice, and rolling changes back. It covers the same ground from the research side and says which order to build in — the short version is that **rollback comes before the AI planner**, because a plan that creates forty issues needs somewhere to go back to.

## Where this is now

The Epic Map is three views that answer three questions about a plan:

| View | Question |
|---|---|
| **Epic Map** (`/epics`) | Is the plan *organised* well? Which tasks sit in the wrong epic, which epics overlap, which kinds of work have no epic, and what would change if you moved things? |
| **Roadmap** (`/roadmap`) | Will the plan *execute*? Every epic on one timeline with the dependencies between them, the chain that decides when the plan ends, how much slack each epic has, and what is broken about the plan as it stands. |
| **Gantt** (`/gantt`) | What is the work itself? Bars you can drag, conflicts, baselines, releases. |

The three share one engine. `src/model/plan/cpm.ts` turns the epics, their dates and the links between them into a forward and a backward pass, total float per epic, the critical chain, and four kinds of broken plan (a loop, an epic that starts before its blocker is finished, work that finishes after its release is due, and epics with no dates or no release). The Epic Map and the Roadmap both show those problems, worded the same way.

A model on your own machine (opt-in, localhost only, off by default) can read the plan and propose things: which items really block each other, which epics should ship together, what an epic's mix of work really is. Nothing it says is applied by itself, and nothing it says is shown until it passes a deterministic check in `src/model/plan/infer.ts`: real items, still open, not already linked, no loop, and **a reason that is a quote which really appears in one of the two issues**. About one model proposal in five is wrong, so every proposal is a click, and every click is an ordinary recorded change that undo works on.

## The plan

Each phase below is small enough to be one PR. The order is by value, not by effort.

### Phase 10: a working calendar — done

**Why.** Bars are drawn on plain calendar days. A plan that runs through a weekend is wrong in a way every reviewer spots, and it quietly lengthens the critical chain — so the float and the "ends on" date are both wrong. The scheduling literature treats non-working days as a first-class input, not a detail.

**What was built.**
- `src/model/calendar.ts`: the working days of the week, the days that are off whatever the week says, and the arithmetic to count and step over them.
- The plan engine works in working days: the forward pass starts the next piece of work on a working day, and the backward pass finishes the one before it on the last working day. The dates on the chart do not move — what changes is how long the work really is.
- `src/model/plan/cpm.ts` carries both lengths: `days` (the calendar span) and `workDays` (the days you can work in).
- The Gantt shades the days nobody works in.
- Settings: which days are working days, and the project's holidays.

**Done when.** An epic that spans a weekend is two working days longer on the plan than on the calendar, the critical chain respects it, and the Roadmap's "plan ends" date moves accordingly.

**Not doing.** Public holidays per country, and resource levelling — that needs capacity data pm-hub does not have.

### Phase 11: a plan that can be rolled back — done

**Why.** The AI planner (see `docs/ai-planning-and-voice.md`) will create dozens of issues in one apply. pm-hub's undo after an apply was a forward replay of inverse ops, offered only while the Review tab stayed open, not persisted anywhere, and — for created items — wrong: `inverse(create)` was `archive`, which removes the item from the project but leaves the issue open in the repository. There was no undo ledger and no restore. The research is blunt: no tracker has a durable action-level undo ledger, and point-in-time restore against GitHub is impossible, so the tool must keep its own versioned snapshot.

**What was built.**
- `src/model/rollback.ts`: `rollbackOps(applied)` rebuilds the operations that put an apply back, from the operations it recorded. `summariseRollback` and `rollbackNote` say what it will do.
- The change record now keeps the operations and the ids (`src/store/history.ts`), so an apply can be rolled back days later, in this browser or from the shared history folder.
- The inverse of a create is now **close and archive**, not just archive: GitHub cannot undo a creation, so the issue is closed as well and the interface says so.
- An item taken out of the project carries its GitHub id, so a rollback can address it; the conflict check and the apply both fetch it.
- The Review screen groups by change, so a change of forty items is one row rather than forty (`foldOps` in `src/model/ops.ts`).
- "Roll back" is a first-class action in *What changed*: it stages the rollback in the draft, where it is checked against GitHub, previewed in the dry run, applied like anything else, and undone with one keystroke.
- The discard toast's Undo now puts back what was discarded. It used to undo an earlier change instead.
- Operations that point at an item the apply created are dropped with it, instead of being left pointing at a key that no longer exists.

**Done when.** A plan of forty new issues can be applied, and rolled back days later, and the rollback is one recorded change that can itself be undone.

**Not doing.** Deleting issues. GitHub cannot, and a plan that deletes things is a different product.

### Phase 12: releases without a due date

**Why.** A single-select "Release" field has no due date, so the plan cannot be checked against it and the Roadmap draws no release markers. The check works for milestone-based releases and is silent for field-based ones, which is worse than not having it: the plan looks fine because nothing was checked.

**What.**
- `releaseOf` returns a due date for the field rule when the project has a date field to read it from, or falls back to the end of the release's own work.
- `src/model/plan/cpm.ts` uses it; the Roadmap draws the markers and the Gantt draws the lines.
- `setRelease` is unchanged: releases still have to exist.

**Done when.** A project with a Release field and a due date field has its plan checked against its releases, and an epic that misses its release is named.

**Not doing.** Creating milestones. The API pm-hub uses cannot create them, so a release the project does not have is a release pm-hub cannot put work into.

### Phase 13: two-stage release grouping

**Why.** Today the model names the groups itself, which means the same project can be grouped differently on two runs — the "roadmap churn" failure. The safer recipe is two stages: the model labels each piece of work with a small closed theme, and pm-hub clusters on that label deterministically. The phasing is then reproducible and can be re-derived after any edit.

**What.**
- A theme prompt with a closed label set (the project's own labels and categories), one label per item.
- `cluster` on (theme, epic), in `src/model/epicmap/cluster.ts` or beside it.
- The release suggestion then comes from the clusters, not from the model.

**Done when.** The same project asked twice gives the same grouping, and changing one dependency re-derives it rather than inventing a new one.

**Not doing.** Letting the model choose dates. It is optimistic and unbounded, and it is not a commitment.

### Phase 14: effort as a distribution

**Why.** A model's duration estimate is optimistic and unbounded, and it is very sensitive to how the question is phrased. The defensible contract is a distribution, not a number: three points, expected value and spread computed in the browser.

**What.**
- The model is asked for three points (optimistic, most likely, pessimistic) per epic.
- `te = (o + 4m + p) / 6` and `σ = (p − o) / 6` are computed client-side, and the spread is carried through the plan like a duration range.
- The drawer and the Roadmap show a range, never a single committed date.

**Done when.** An epic the model has sized shows a range on the map, and the critical chain uses the expected length.

**Not doing.** Storing the estimate as a promise, or re-deriving historical estimates with a changed prompt — historical durations are never re-derived.

### The Gantt, made clearer — done

**Why.** The Gantt drew bars but never said what blocked what, and the "critical path" it had was a longest chain by days rather than a real one. The plan engine (phase 9) computes the real thing, so the chart can show it.

**What was built.**
- **Dependency arrows.** The links between items are drawn on the chart, measured from the chart (the rows have different heights). The ones on the critical chain are red.
- **The critical chain on the chart.** The bars that decide when the plan ends are marked.
- **Place, where the plan says.** The Place button used to drop an undated epic into an arbitrary four weeks from today. It now starts it where the plan says it could start: after the work that blocks it.
- **An export of the whole plan.** The Gantt's export is the arrangement of the chart. There is now also the whole plan as CSV and Markdown — every epic and story, with what blocks what and which release it is in — which is the export to take somewhere else.

**Not doing.** Deleting the old export: the arrangement of the chart is a different thing from the plan, and both are useful.

### Later, when there is something to write back

- **An AI that drafts a whole plan.** See `docs/ai-planning-and-voice.md`: the flow, the guardrails and what pm-hub's op model is missing. It goes after phase 11, because a plan that creates dozens of issues needs somewhere to roll back to.
- **Voice.** A local transcription server and a mic that types into the focused field. The browser's own Web Speech API uploads audio to a Google server, so it is out by default.
- **Link types and lag.** Finish-to-start, start-to-start, finish-to-finish, start-to-finish, and a signed lag. GitHub only has "blocked by", so there is nowhere to write these yet; the plan model would need the field before the interface can.
- **Resource levelling.** Smoothing first (it never moves the critical path), levelling only as a trade the user opts into. Needs per-person capacity, which pm-hub has hints of but not enough of.
- **Work outside the project.** The loader fetches only what is in the project, so a dependency on an issue that is not in it can only be reported, never modelled.

## Rules (don't break these)

1. **Every edit goes through `editor.record(label, ops)`, using the helpers in `src/model/edits.ts`** (`moveToParent`, `newItem`, `setLabels`, `setLane`, `splitItem`, `setRelease`). Don't add a new `Op` kind unless you cannot avoid it.
   - Ops that undo together go in one `record` call.
   - Nothing writes to GitHub outside `src/github/apply.ts`. `test/write-guard.test.ts` enforces this.
2. **The model is pure and unit-tested.** Put logic in `src/model/` (`epicmap/` for the map, `plan/` for the schedule and the checks). Views only render it and call `record`.
3. **When `editor` is undefined, the view is read-only.** Hide every action button and make nothing draggable.
4. **Tests use synthetic data only** (`makeFixture`, `demoProject`). Never use real project data.
5. **Network policy.** The built page may only talk to `api.github.com` (the CSP in `vite.config.ts`), plus localhost for the opt-in model.
6. **The model proposes; the code decides.** Every model answer passes a deterministic check before it is shown (`src/model/plan/infer.ts`), and nothing is applied without a click. Do not show the model's own confidence: show the quote and the items, so the reader can check them.
7. **Style.** Short "why" comments, CSS variables from `src/ui/tokens.css` and the `--cat-*` tokens in `epicmap.css`, and check both light and dark themes.
8. **One PR per phase**, titled `v2 phase N: …`.

## What exists

| Area | Files | Notes |
|---|---|---|
| The map (pure) | `src/model/epicmap/index.ts`, `text.ts`, `categories.ts`, `graph.ts` | `analyze(project, mapping, {openOnly, vectors})` returns tasks (+ misfit), epics (health, cohesion, coupling, mix, flags), overlaps, moves, gaps and a structure score. `scoreIfMoved` previews a drop. |
| The map's advice (pure) | `src/model/epicmap/suggest.ts`, `cluster.ts`, `quests.ts`, `lens.ts` | Move / merge / split / create-epic suggestions with their gain; clustering of similar tasks; the four quests; the lenses (category, release, assignee, priority). |
| The plan (pure) | `src/model/plan/cpm.ts`, `infer.ts` | The forward and backward pass, float, the critical chain, the four kinds of broken plan, and the gate every model proposal passes. |
| Canvas | `src/views/epicmap/canvas.ts` | Cytoscape + fCoSE, loaded lazily so it is its own chunk. Epics are compound nodes, tasks are child nodes, `tray` is "No epic", `g:<category>` are gap ghosts. The canvas never edits anything. |
| Views | `src/views/EpicMap.tsx`, `Roadmap.tsx`, `epicmap/`, `plan/` | The map, the roadmap, the suggestion deck, meeting mode, the timelapse, and the plan check. |
| The model | `src/ai/local.ts`, `src/views/useLocalModel.ts`, `usePlanSuggestions.ts` | The client, the prompts, and the two hooks. Localhost only; a failure is always a fallback, never an error. |
| Memory | `src/store/epicmap.ts`, `src/store/cache.ts` | What you turned down, the cached embeddings and answers, and the local model's settings. |
| Data | `src/github/queries.ts`, `src/model/normalize.ts` | Issue and draft bodies, clipped to 2,000 characters. Blocked-by links (up to 25 per issue, one direction). |
| Demo data | `src/demo/fixture.ts` | `TOPICS` gives each epic its wording; `STRAYS` plants misplaced stories and a security theme no epic owns; two epics are blocked by an earlier one but start before it is finished, so the plan has something real to find. |
| Tests | `test/epicmap.test.ts`, `suggest.test.ts`, `plan.test.ts`, `quests.test.ts`, `local.test.ts`, `render.test.tsx` | `npm test`, plus `npm run typecheck` and `npm run build`. |

## Known limits

- The structure score is modularity, and modularity likes few large groups: splitting an epic always lowers it a little, even when the split is right.
- The category dictionary in `categories.ts` is fixed and global. An editable, per-project dictionary belongs in a later phase.
- Pull requests are left out of the map, because a GitHub PR cannot have a parent issue.
- Epic labels shrink when the map is zoomed out; a `min-zoomed-font-size` keeps them readable, but a constant-size overlay would be better.
- Similarity is plain TF-IDF over titles, bodies and labels. The generic verbs filtered by `GENERIC` in `text.ts` need extending for real projects.
- The plan works in calendar days. See phase 10.
