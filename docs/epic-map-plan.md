# The Epic Map and the plan: what is next

Where the Epic Map stands, and what is left to build. Every phase below is done except the ones in "Later".

The research behind the last phases is in `reports/AI assisted roadmap planning.md` (87 sourced links; the raw notes are not in the repo).

**There is a second analysis** in `docs/ai-planning-and-voice.md`: what to do about the Gantt, an AI that drafts a whole plan, voice, and rolling changes back. It covers the same ground from the research side and says which order to build in — the short version is that **rollback comes before the AI planner**, because a plan that creates forty issues needs somewhere to go back to. That is the order they were built in.

**And a third** in `docs/hands-free-and-collaborative.md`: making the app usable without a keyboard or a mouse, easy enough to be obvious, and workable with other people. The short version: one command surface that takes speech, keys or typing; a real voice loop rather than a dictation box; and collaboration built on a legible shared record rather than on co-editing, because every structured plan tool in the world is last-writer-wins and the research says the payoff is a shared mental model, not a merge algorithm.

## Where this is now

The Epic Map is four views that answer four questions about a plan:

| View | Question |
|---|---|
| **Epic Map** (`/epics`) | Is the plan *organised* well? Which tasks sit in the wrong epic, which epics overlap, which kinds of work have no epic, and what would change if you moved things? |
| **Roadmap** (`/roadmap`) | Will the plan *execute*? Every epic on one timeline with the dependencies between them, the chain that decides when the plan ends, how much slack each epic has, and what is broken about the plan as it stands. |
| **Gantt** (`/gantt`) | What is the work itself? Bars you can drag, the dependencies drawn between them, the chain that decides the end date marked, conflicts, baselines, releases. |
| **Planner** (`/planner`) | What should the plan *be*? Describe it — by typing or by speaking — and a model on this computer drafts the epics, stories, dates, release and dependencies. You read it, tick what you want, and it becomes one change. |
| **Compare** (`/compare`) | What do these two epics cover, what do they have in common, and what does only one of them have? Drag a story from one to the other to move it. |

The first three share one engine. `src/model/plan/cpm.ts` turns the epics, their dates and the links between them into a forward and a backward pass, total float per epic, the critical chain, and four kinds of broken plan (a loop, an epic that starts before its blocker is finished, work that finishes after its release is due, and epics with no dates or no release). The Epic Map and the Roadmap both show those problems, worded the same way, and the Gantt draws the chain.

A model on your own machine (opt-in, localhost only, off by default) can read the plan and propose things: which items really block each other, which epics should ship together, what an epic's mix of work really is, what the whole plan should be. Nothing it says is applied by itself, and nothing it says is shown until it passes a deterministic check in `src/model/plan/infer.ts`: real items, still open, not already linked, no loop, and **a reason that is a quote which really appears in one of the two issues**. About one model proposal in five is wrong, so every proposal is a click, and every click is an ordinary recorded change that undo works on.

**And any of it can be put back.** An apply keeps the operations and the ids it used, so *What changed* can roll it back days later: checked against GitHub, previewed, applied like anything else, undone with one keystroke.

## The plan

Each phase below is small enough to be one PR, and each was one. The order was by value, not by effort.

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

### Phase 12: releases without a due date — done

**Why.** A single-select "Release" field has no due date, so the plan cannot be checked against it and the Roadmap draws no release markers. The check works for milestone-based releases and is silent for field-based ones, which is worse than not having it: the plan looks fine because nothing was checked.

**What was built.**
- The mapping has a **release due date field**: the date field that says when a release is due. It is detected by name and can be set in *Settings → Grouping*.
- `releaseOf` returns that date for a field-based release, so the plan engine, the Roadmap's markers and the Gantt's lines all have something to work with.
- `setRelease` is unchanged: releases still have to exist.

**Done when.** A project with a Release field and a due date field has its plan checked against its releases, and an epic that misses its release is named.

**Not doing.** Creating milestones. The API pm-hub uses cannot create them, so a release the project does not have is a release pm-hub cannot put work into.

### Phase 13: two-stage release grouping — done

**Why.** The model used to name the groups itself, which means the same project can be grouped differently on two runs — the "roadmap churn" failure. The safer recipe is two stages: the model labels each piece of work with a small closed theme, and pm-hub clusters on that label deterministically. The phasing is then reproducible and can be re-derived after any edit.

**What was built.**
- The model labels each epic with a theme from a closed set — the project's own releases — and leaves out anything that belongs to none of them.
- `groupByTheme` (`src/model/plan/infer.ts`) does the grouping, so the same labels always give the same groups, whatever order they arrive in.
- The release suggestions then come from those groups, and every check they used to pass still applies: a release that exists, epics that are not already in it, and operations that can be recorded.

**Done when.** The same project asked twice gives the same grouping, and changing one dependency re-derives it rather than inventing a new one.

**Not doing.** Letting the model choose dates. It is optimistic and unbounded, and it is not a commitment.

### Phase 14: effort as a distribution — done

**Why.** A model's duration estimate is optimistic and unbounded, and it is very sensitive to how the question is phrased. The defensible contract is a distribution, not a number: three points, expected value and spread computed in the browser.

**What was built.**
- The planner asks for three lengths per piece of work: optimistic, most likely and pessimistic.
- `estimate` (`src/model/plan/draft.ts`) computes the expected length the way PERT does, `(o + 4m + p) / 6`, and the range it could be.
- The bar is drawn at the expected length, and the draft shows the range beside it: "3d (2–6)".
- A piece of work with one number still works: the range is the number.

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

### The command surface, the voice loop and working together — planned

**Why.** Three things at once: usable without hands, easy enough to be obvious, and workable with other people. The analysis is in `docs/hands-free-and-collaborative.md`; the research behind it is in `research_notes/Hands free and collaborative/`.

**Phase 15 — one command surface — done.** A single bar that takes speech, keys or typing, and turns "move the API epic two weeks later" into ordinary operations.

What was built:
- `src/model/command/targets.ts`: `findTargets` — type-aware ("the API *epic*"), number-aware ("#123"), release-aware ("in the March release"), and scored on the words for the rest.
- `src/model/command/intent.ts`: a grammar for the actions that exist, tried **before** any model, because a model-routed command tops out near 0.73 and its mistakes are missing and wrong arguments. A missing slot becomes a question, never a guess.
- `src/model/command/ops.ts`: an intention becomes the same operations a mouse click makes. It adds the two the app was missing: a named-epic merge and archiving.
- The command menu takes the sentence as a pinned entry with a preview of what it will do, asks which item when it is not sure, and has a microphone that dictates into the same box.

Still to do in this phase: a model filling in what the grammar cannot parse, and the relative-date expressions ("to the 15th", "before the release").

**Phase 16 — the voice loop — done.** Push to talk on `Ctrl+Shift+Space`, the app answering out loud, directive prompts instead of yes/no questions, and every spoken answer paired with something visible.

**Phase 17 — together — done.** A proposal in the shared plan history, the comments on the plan's own issues read back so a colleague's writing is visible, and the last-second race between the check and the apply closed.

**Phase 20 — the planner, three ways — done.** "Is it already here?" matches what you describe against the epics you have and shows which pieces are already covered and which are not, with a way to add the missing ones to the epic that covers the rest. "Tidy an epic" asks a model to read an epic's stories and say what is missing, what is named badly and which two repeat each other; the person ticks what they want. Both reuse the machinery that was already there: the story matcher, the ops, and the review screen.

**Phase 19 — light and dark, and better type — done.** The theme is a real system, not a stylesheet: a switch in the top bar (light, dark, or the system), applied before the first paint so it never flashes, remembered, and the charts read their colours out of the page. The type moves to Inter and JetBrains Mono, with a type scale, tighter tracking and real focus rings.

**Phase 18 — easy for everyone — mostly done.** Focus management in the drawer and the modal, live regions, unique ids in the picker, roles on the progress bars, a keyboard way to select a row, and the chart views saying where the same information can be read as text. Still to do: a text equivalent of the Gantt and the Epic Map for screen readers, and the Epic Map's live region, which mounts with its text already in it.

### Later, when there is something to write back

- **Link types and lag.** Finish-to-start, start-to-start, finish-to-finish, start-to-finish, and a signed lag. GitHub only has "blocked by", so there is nowhere to write these yet; the plan model would need the field before the interface can.
- **Resource levelling.** Smoothing first (it never moves the critical path), levelling only as a trade the user opts into. Needs per-person capacity, which pm-hub has hints of but not enough of.
- **Work outside the project.** The loader fetches only what is in the project, so a dependency on an issue that is not in it can only be reported, never modelled.
- **A spoken conversation, not just dictation.** The microphone now types into whatever field has the focus, and the planner takes a spoken description. Making the model *answer* out loud, and carrying a conversation across several turns, is phase 16 above -- `speechSynthesis` with a local voice is the easy half.
- **A draft that can be edited.** The planner's draft can be ticked or unticked, but not renamed or re-dated. Editing the draft is a table of inputs, not a canvas.
- **The plan's own history.** Baselines keep the shape of the plan but not the labels, the assignees or the links, so a baseline cannot be restored -- only compared with. A snapshot that could be put back would be a different thing.

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
