# Epic Map: plan for the remaining phases

This is the build plan for the rest of the Epic Map, written for whoever picks it up next. Phase 5 (v1) is done. Phases 6–8 below are still to build.

## What exists (phase 5, done)

| Area | Files | Notes |
|---|---|---|
| Analysis engine (pure) | `src/model/epicmap/text.ts`, `categories.ts`, `graph.ts`, `index.ts` | `analyze(project, mapping, {openOnly})` returns `EpicMapModel` with: tasks (+ misfit flag), epics (health, cohesion, coupling, category mix, flags), overlaps (score + shared words), moves, gaps, structure score. `scoreIfMoved(model, taskKey, epicKey)` previews a drop. |
| Canvas | `src/views/epicmap/canvas.ts` | Cytoscape + fCoSE, loaded lazily (`import()` in `EpicMap.tsx`), so it is its own chunk. Epics are compound nodes, tasks are child nodes, `tray` is "No epic", `g:<category>` nodes are gap ghosts. Drag is hit-tested on `grab`/`drag`/`free` and reported through `CanvasEvents.drop`. The canvas never edits anything. |
| View | `src/views/EpicMap.tsx`, `src/views/epicmap/epicmap.css` | Score, misplaced tasks (Move button), gaps (Create epic), overlaps, epic health, legend. The tab is registered in `src/router.ts` (`"epics"`) and `src/views/ProjectScreen.tsx` (`TABS` and the render branch). |
| Data | `src/github/queries.ts`, `types.ts`, `src/model/normalize.ts` | The issue/draft `body` is fetched and clipped to 2,000 characters (`Item.body?`). |
| Demo data | `src/demo/fixture.ts` | `TOPICS` gives each epic its wording. `STRAYS` plants misplaced stories and a security theme no epic owns. |
| Tests | `test/epicmap.test.ts`, `test/render.test.tsx` | Run with `npm test`. Also run `npm run typecheck` and `npm run build`. |

## Rules (don't break these)

1. **Every edit goes through `editor.record(label, ops)`, using the helpers in `src/model/edits.ts`** (`moveToParent`, `newItem`, `setLabels`, `setLane`, `splitItem`). Don't add a new `Op` kind unless you cannot avoid it.
   - Ops that undo together go in one `record` call.
   - Nothing writes to GitHub outside `src/github/apply.ts`. `test/write-guard.test.ts` enforces this.
2. **The model is pure and unit-tested.** Put logic in `src/model/epicmap/`. Views only render it and call `record`.
3. **When `editor` is undefined, the view is read-only.** Hide every action button and make nothing draggable.
4. **Tests use synthetic data only** (`makeFixture`, `demoProject`). Never use real project data.
5. **Network policy.** The built page may only talk to `api.github.com` (the CSP in `vite.config.ts`). Phase 7 widens this to localhost only, and only for the opt-in model.
6. **Style.** Short "why" comments, CSS variables from `src/ui/tokens.css` and the `--cat-*` tokens in `epicmap.css`, and check both light and dark themes.
7. **One PR per phase**, titled `v2 phase N: …`.

## Phase 6: Suggestions and gaps

Goal: a deck of suggestion cards you can accept, reject or snooze, covering move, merge, split and create-epic.

1. **`src/model/epicmap/suggest.ts`**, exporting `suggestions(model, project, mapping): Suggestion[]`. Each suggestion is `{ id, kind: "move"|"merge"|"split"|"gap", title, why, gain, ops: Op[] }`, where `id` is stable (e.g. `merge:<a>|<b>`).
   - **move:** taken from `model.moves`. The ops are `moveToParent`.
   - **merge:** for overlaps with `score >= 0.35`.
     - The survivor is the larger epic.
     - Ops: `moveToParent` for every child of the other epic, then `{kind:"archive", key}` for the emptied epic.
     - `gain` = the score after applying the ops, minus the score now. Compute it with `applyOps` and `analyze`.
   - **split:** for epics with ≥ 6 tasks.
     - Run community detection on the epic's own sub-graph (its tasks and their edges in `model.edges`). Either add `graphology` + `graphology-communities-louvain`, or write a small label-propagation function; label propagation is enough at this size.
     - Only suggest a split when there are ≥ 2 communities of ≥ 3 tasks each.
     - Ops: `splitItem(project, mapping, epic, "<epic title> (part 2)", keysOfSecondCommunity)`.
   - **gap:** taken from `model.gaps`. Use the same ops as `claim` in `EpicMap.tsx`; move that code into `suggest.ts` and reuse it.
   - **Sort order:** by `gain`, highest first, then by kind priority: gap > merge > move > split.
2. **Rejection memory: `src/store/epicmap.ts`**, using `idb-keyval` with keys like `emap-rejected:<owner>/<number>`.
   - Store a `Record<suggestionId, "rejected" | {snoozedUntil: iso}>`.
   - Snooze lasts 7 days.
3. **UI: `src/views/epicmap/Suggestions.tsx`** replaces the "Tasks that may be in the wrong place" and "Work with no epic" sections.
   - Each card: title, why, a `+gain` chip, and Accept / Reject / Snooze buttons.
   - Hovering a card calls `canvas.focus(...)` on the epics involved.
4. **Canvas:** clicking a ghost node opens the matching gap card. Don't create the epic directly; that is today's `claim`.
5. **Tests:**
   - merge is suggested for two near-identical synthetic epics;
   - split finds two clusters in a synthetic epic built from two topics;
   - accepted merge ops undo cleanly (`applyOps` on `ops` and then on `ops.map(inverse).reverse()` gives the original parents);
   - rejected ids are filtered out.

## Phase 7: Local Qwen (optional, opt-in)

Goal: better similarity, category names, explanations and gap ideas from a model running on the user's own machine. Nothing goes to a hosted service.

1. **`src/ai/local.ts`:**
   - A client for an OpenAI-compatible endpoint: `POST {base}/embeddings`, and `POST {base}/chat/completions` with `response_format: {type:"json_object"}`.
   - Settings `{ enabled: false, base: "http://localhost:11434/v1", chatModel: "qwen3", embedModel: "qwen3-embedding" }`, stored in prefs (`src/store/cache.ts` `Prefs`). Add a settings section in `src/views/Settings.tsx` with a "Test connection" button.
   - A 20 s timeout on every call. Any failure returns `null`, and the caller falls back to local results.
2. **Embeddings:**
   - `analyze` accepts an optional `vectors?: Map<itemKey, number[]>`. When present, use dense cosine instead of TF-IDF in `buildEdges` and the centroids.
   - Keep `graph.ts` generic: give it a `similarity(i, j)` function, or precomputed top-k lists.
   - Cache the vectors in IndexedDB, keyed by a hash of `title + body`.
3. **Chat uses** (each validated with a tiny schema check, with any invalid answer dropped):
   - name an epic's category mix;
   - a one-sentence explanation of an overlap;
   - gap ideas: given the epic titles plus a category histogram, return up to 3 `{title, why, taskKeys}`, keeping only keys that exist.
4. **CSP:** in `vite.config.ts`, add `http://localhost:* http://127.0.0.1:*` to `connect-src`.
5. **README:** state plainly that only issue text goes to your own localhost model and the GitHub token never does. Document `OLLAMA_ORIGINS=https://nfbutt.github.io` for CORS.
6. **UI:** a status pill in the Epic Map header ("Qwen connected" / "Local analysis"), and a "✦" marker on any text the model wrote.
7. **Tests:** stub `fetch`. Cover a happy path, invalid JSON being dropped, and the endpoint being down while `analyze` still works.

## Phase 8: Meeting mode, timelapse and quests

1. **Meeting mode** (`src/views/epicmap/MeetingMode.tsx`): a full-screen overlay.
   - Agenda: the 5 worst epics by health, then the top 5 suggestions.
   - "Next" focuses each item (`canvas.focus`), with an optional 3-minute timer per item.
   - A session tally of moves, merges, new epics and score change, kept in component state.
   - At the end, a summary card with a link to the Review tab (`hrefFor(routeFor("review"))`).
2. **Timelapse** (`src/views/epicmap/Timelapse.tsx`): a slider over the plan-history baselines (`useHistory().baselines`; `src/model/diff.ts` `Baseline` has `parentKey`/`epic` per item).
   - Rebuild a `Project`-like view of each baseline, run `analyze`, and show score over time as a sparkline (reuse `src/ui/charts.tsx`).
   - Animate the canvas between baselines by calling `canvas.update`.
3. **Quests:** a pure `quests(modelBefore, modelNow)` that returns progress on "Resolve 3 overlaps", "Adopt every orphan", "Fill a gap" and "Raise the score by 10".
   - Show them as a small card in the panel.
   - Store finished quests with the plan history so the team sees them.
4. **Lenses:** a toolbar switch for colour and grouping: Category (default) · Release · Assignee · Priority.
   - Pass `lens` into `elements()` in `canvas.ts`, and use `releaseOf` / `priorityOf` / the assignees for the `cat` data.

## Known limits of v1 (good first fixes)

- Epic labels are drawn in model units, so they shrink when you zoom out. Consider a constant-size label overlay or a `min-zoomed-font-size` tweak.
- Similarity is plain TF-IDF over titles, bodies and labels. Generic verbs are filtered by `GENERIC` in `text.ts`; extend that list for real projects.
- The category keywords in `categories.ts` are fixed. An editable dictionary (stored per project) belongs in Phase 6 or 7.
- Pull requests are left out of the map, because GitHub PRs can't have a parent issue.
