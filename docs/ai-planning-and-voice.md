# Making the Gantt, the planner and the rollback better

An analysis of the three things asked for: a better Gantt, voice for every page plus an AI that plans, and a way to roll things back.

It follows the code assessment (what pm-hub has today) and the research (`reports/AI assisted roadmap planning.md` and the notes in `research_notes/AI planning voice and rollback/`). Where a claim is from the research it is marked; everything about pm-hub's own code was read and checked.

## The short answer

1. **The rollback has to come first.** The AI planner will create dozens of issues at once, and pm-hub's undo after an apply is a forward replay that is offered for about as long as the Review tab stays open, is not persisted, and **leaves the created issues alive in the repo**. Building the planner before fixing that means the first bad plan leaves junk in someone's repository.
2. **Voice is a local-model feature, not a browser feature.** Chrome's Web Speech API uploads your audio to a Google server. pm-hub promises that nothing leaves the computer, so the Web Speech API is out by default; the route is a localhost transcription server, the same way the local chat model already works.
3. **The AI planner should write pending operations, not items.** pm-hub already has a Review screen that previews changes before they reach GitHub. A generated plan becomes one recorded change made of ordinary ops, shown in that screen, undone with one keystroke.
4. **The Gantt's biggest remaining gap is dependency arrows**, and the plan engine built in phase 9 already computes everything needed to draw them.

## 1. What the Gantt is missing

Today the Gantt draws bars, release markers, a today line, conflicts and baselines. It does **not** draw dependencies — the only dependency affordance is a small dot you drag from one bar to another. `src/model/deps.ts` has a dependency graph and a "critical path" that is a longest chain by remaining days, not CPM: no slack, no early/late dates, no milestones.

Phase 9 added the real engine (`src/model/plan/cpm.ts`): the epic-level dependency graph, a forward and backward pass, total float, the critical chain, and the reasons a plan cannot work. It is used by the Roadmap and the Epic Map. The Gantt is the one view that does not use it yet.

**In value order, the Gantt's remaining work is:**

| Change | Why it matters | Cost |
|---|---|---|
| **Dependency arrows** | The chart stops being a list of bars and becomes a plan you can read. | Medium: the Gantt's rows have dynamic heights, so the arrow geometry needs measuring the DOM rather than computing it. |
| **The critical chain drawn on the Gantt** | Instant answer to "what decides the date?" — the same chain the Roadmap shows, in the view people already use. | Low: the plan engine already computes it; only the styling is new. |
| **A working calendar** | Bars run through weekends, which every reviewer spots, and it quietly lengthens the critical chain so the float is wrong. | High: it touches `src/model/schedule.ts` and everything that reads it. Phase 10 in the plan. |
| **"Place" that respects the plan** | The Place button drops an undated item into an arbitrary four-week window from today. It could instead place it after its blockers and before its release, using the plan engine. | Low. |
| **Export that includes everything** | `src/model/export.ts` exports only the Gantt's *epic* rows: no sub-issues, no dependencies, no releases, no labels, no assignees. `parseCsv` exists and is unused, so an import path is nearly free. | Low. |
| **A what-if** | "If this epic slips two weeks, what moves?" The plan engine has the chain and the float; the answer is one calculation. | Medium. |

## 2. Voice

### The trap

The browser's obvious answer is the Web Speech API. MDN's own documentation says the default implementation "uses a server-based recognition engine… Your audio is sent to a web service." That is the opposite of pm-hub's promise, and it is not a bug that will be fixed — it is the design of the API.

There is movement: Chrome 139 shipped on-device Web Speech (`processLocally`, `available()`, `install()`) in 2025, desktop only and still marked experimental; Firefox 157 implemented an on-device engine (Parakeet) behind a pref. Safari has the prefixed API and nothing local. So the browser may get there, but pm-hub cannot depend on it today, and it must not depend on it at all if the promise is to hold on a browser that has not shipped it.

### The route that fits pm-hub

pm-hub already speaks to an OpenAI-compatible server on localhost (`src/ai/local.ts`). The same server API has a transcription endpoint: **Speaches** exposes `POST /v1/audio/transcriptions` on localhost with streaming and dynamic model loading, and **faster-whisper-server** is converging on it. So the client change is one method next to `embed` and `chatJson`, and the settings gain one address.

Two things fall out of that:

- **Dictation for every page.** A mic button in the shell that transcribes into whatever field has focus. This is the "voice for all pages" piece, and it is the small one: no conversation, no model, just speech into the focused input.
- **A spoken planning conversation.** The "AI mind": speech → the existing local chat endpoint → an answer, read back with `speechSynthesis` (filter for `localService === true`) or a local Piper/Kokoro voice on the same server. This is where voice earns its keep, because talking is much easier than typing a plan description.

The alternative to a local server is Whisper in the page (whisper.cpp compiled to WebAssembly, or Transformers.js). It is genuinely private and works in Safari, but the base model is roughly 77 MB to download, there is no true streaming, and WebGPU support is incomplete. It is a good fallback for a user with no server, not the default.

**One thing to verify before designing around it:** whether an HTTPS page (pm-hub is served from GitHub Pages) may POST to `http://localhost`. Both Chrome and Firefox treat `http://localhost` as a secure origin, so it is very likely fine, and the existing local-model feature already depends on exactly this working — but it should be confirmed on a real deployed page rather than assumed.

**One thing to decide:** whether voice is a separate localhost server from the chat model, or whether the settings grow a second address. Ollama does not transcribe, so with Ollama today the answer is "a second address", and pm-hub should say so plainly in the settings rather than hiding it.

## 3. The AI planner

### What the tools do

The shipped features split three ways (research): trackers that generate a plan natively (Asana's AI project plan template — "tasks, milestones, owners, timelines, and dependencies"; ClickUp Brain; monday's Project Planner Agent), tools that produce a document (Notion AI), and tools that only advise (GitHub's issue-triage tool). The output schema converges on tasks + milestones + owners + dates + dependencies, grouped into epics, with a risk layer on top (monday flags missing owners, tight timelines, overlapping commitments). **No vendor documents how it sets dates** — it is the model's guess.

The review step is where the tools differ, and it is the important part: monday waits for approval before writing anything to the board; Asana writes and lets you edit afterwards; ClickUp has no gate. **No tool in the category has a diff-style write preview.**

pm-hub can do better than all three, because it already has one: the Review screen previews every change before anything reaches GitHub, checks it against GitHub for conflicts, and shows a dry run of the exact API calls.

### The evidence, honestly

LLM-written project plans have been rated **on par with human-written plans by human reviewers** — but LLM reviewers systematically preferred the AI output by about a fifth of a scale. Two lessons: a model is not a good judge of a plan (so pm-hub's own checks and the user's review must do that work), and an AI plan is not obviously bad. The research also found no published rates for filler tasks, invented dependencies or churn, so those are risks to design around rather than numbers to quote.

### Writing it back to GitHub

This is expressible: create an issue with a parent (`parent_issue_id`), set project field values (dates, single-selects), set a milestone, and add "blocked by" relationships. The real limits are permissions (assignees are silently dropped without push access), notifications, and 500 content-creating requests per hour.

pm-hub's own op model is what needs work. The gaps, from the code:

- `newItem` (`src/model/edits.ts:151`) can set a title, a repo, a parent, some labels and the lane field. It **cannot** set dates, a milestone, assignees or an arbitrary field on a new item, and it **cannot point a new item at another new item** — its parent is looked up in the base project. `splitItem` shows the pattern for chaining creates (`create` then `setParent` with the draft key), and `execute` resolves created keys, so the machinery is there; the helper is not.
- A `create` op *can* carry arbitrary field values in `op.item.fields` — `execute` patches them after creation. So dates on a new item are a helper away, not a new op kind.
- There is **no `createMilestone`** in `src/github/mutations.ts`, and `test/write-guard.test.ts:33` asserts there are exactly 17 mutations. So a generated plan can only put work into milestones that already exist. Adding one is possible (and the count updated) but creating a milestone in someone's repository is a visible, permanent act — it should not happen as a side effect of a plan.
- There is no op for a body, an issue type, or a dependency other than "blocked by".

### The shape it should take

1. The user describes the plan — by voice or text.
2. The model drafts it: **epics, stories, dependencies, releases and dates**, using the project's own vocabulary (its labels, its milestones, its release names, its categories). The prompt must offer the closed sets; the research is clear that constraining the model to a closed set of relations is what makes the output usable.
3. pm-hub checks the draft before showing it: the same gate as `src/model/plan/infer.ts` — real items, no loops, dependencies with a quote that can be found.
4. The user reviews it in a table: every epic and story, with what it will create, what it will change and what it will link. Items can be dropped, renamed, re-dated.
5. Accepting it records **one change** of ordinary ops, so it undoes with one keystroke and applies through the existing Review screen — conflict check, dry run, reasons, status update.
6. It can be exported instead: CSV, Markdown and JSON of the whole plan (the existing export only covers epic rows).

**Guardrails, from the research and from what went wrong in the industry:** no bulk write without review; a cap on how many items one plan may create; a preview of the exact API calls (pm-hub already has this in the Review screen); and never a model's own confidence number — show the items and the reasons.

## 4. Rollback

### What exists today, and why it is not enough

pm-hub has three different things called undo, and they have different reach:

| Mechanism | Reach | Limit |
|---|---|---|
| **Draft undo** (Ctrl+Z, the ↶ button) | Cursor over the change list. Undo is complete *within the draft*, and a whole batch undoes as one step if it was recorded in one `record()` call. | Only before an apply. |
| **Discard** (per item, per scenario) | Drops the ops from the active scenario. | Permanent: the ops are deleted, not moved behind the cursor, so they are not redo-able. The toast's "Undo" button after a discard calls `cs.undo()`, which undoes a *different, earlier* change — the discarded ops are not restored. A real inconsistency, worth fixing on its own. |
| **"Prepare a revert of this apply"** | Records the inverse ops as a new change, which you then apply normally. | Offered **only in the Review tab, immediately after an apply**. The inverse ops live in the component's state (`Review.tsx:43`), so navigating away loses them. `ChangeRecord` in the history stores labels and statuses, **not the op payloads**, so they cannot be reconstructed later. |

Two deeper problems, both verified in the code:

- **`inverse(create)` is `archive`, and archiving does not delete.** A revert of a 40-item plan sends 40 `ARCHIVE_ITEM` calls: the issues are removed from the project but stay open in the repository. The research is unambiguous that GitHub's reversible primitive is **close, not delete** — deletion is permanent and admin-gated — so the honest undo is "close the issue and take it out of the project", and the interface has to say so.
- **`unarchive` cannot restore an archived item.** `applyOps` drops archived items (`src/model/ops.ts:138`), the loader never loads them (`src/model/normalize.ts:185`) and the conflict check skips them (`src/github/apply.ts:208`), so once an item has been archived and the project reloaded, the op has no item to act on. It works inside a draft only because the base project still has the item.

And one structural point: **applied ops are destroyed** from the scenario by `removeSlots` after an apply. There is no post-apply undo at all — only a forward replay, computed in the Review component.

### The research says what the answer is

No tracker offers a durable action-level undo ledger. Linear and monday are the only two that document undo of bulk operations as a unit (monday's Activity-Log undo covers Batch Actions for seven days); Asana, ClickUp, Trello and Notion have shallow undo, and Jira has no native bulk revert at all. The research conclusion: **point-in-time restore against GitHub is impossible**, so the tool must keep its own versioned snapshot, and undo must be operation-scoped, time-bounded, previewable and conflict-aware.

### What pm-hub should build

**A plan is a named, durable unit.** Today a batch is only implicit — "one `record()` call with many ops" — and it evaporates after the apply. Make it explicit:

- A `Plan` object: `{ id, name, createdAt, ops, baseKeys }` — the ops, not just the labels.
- Stored in the history alongside the change records, so a plan applied on Tuesday can still be rolled back on Friday. This means `ChangeRecord` grows the op payloads (or a reference to them).
- The Review screen groups by plan, so a generated plan is one row, not forty.

**A durable undo.** "Roll back the plan applied at 14:32" becomes a first-class action that survives a reload, shows exactly what it will do (a preview of the calls, like the dry run), and is conflict-aware — it re-reads the affected items and says what changed underneath.

**A real create-inversion.** The inverse of a create becomes: close the issue (`state_reason: not_planned`), then archive it from the project — and the interface says plainly that the issues stay in the repository, closed, because GitHub cannot undo a creation. The revert also has to fetch archived items so the operation can be addressed at all.

**A rollback, not just an undo.** Restoring the plan to how it was means applying the inverse of everything the plan touched, including the items it created, the fields it set and the links it added — as one recorded change, so it can itself be undone.

### The narrow bug worth fixing regardless

The discard toast's Undo button does not restore what was discarded (it undoes an earlier change). Small, but it is the kind of thing that teaches people not to trust Undo.

## 5. The order

**Phase A — Rollback (no AI, no voice).**
Make a plan a durable unit; persist the ops; make "roll back this apply" survive a reload; fix the create-inversion so a rollback closes and archives rather than orphaning; fix the discard toast. Everything after this is safer, and the tests are pure model tests.

**Phase B — The AI planner.**
The draft → review → one recorded change → apply flow, using the existing Review screen. Needs the op helpers (`newItem` with dates and fields, a new item as a parent) and the same deterministic gate the Epic Map's suggestions already use. Not exported yet: the whole point is that it lands in GitHub as reviewed changes.

**Phase C — Voice.**
Dictation into the focused field first (small, no conversation), then the spoken planning conversation on top of the local chat model. Needs a decision on the transcription server and a check that an HTTPS page can reach `http://localhost`.

**Phase D — The Gantt.**
Dependency arrows, the critical chain drawn on the chart, "Place" that respects the plan, a full export (and the CSV import that `parseCsv` already half-exists), then the working calendar.

Phase A before B is not a preference. The planner creates dozens of issues in one apply; the current undo for that case is a button that disappears when you change tab, and leaves the issues open in the repo.
