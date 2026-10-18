# pm-hub

Roadmaps, Gantt charts and delivery forecasts for any GitHub Project, and a fast way to keep the plan current as it changes. It runs entirely in your browser.

**Open it:** https://nfbutt.github.io/pm-hub/ · or [try the demo project](https://nfbutt.github.io/pm-hub/#/demo/gantt) without a token.

![Gantt view of the demo project: epics in swimlanes with release markers, a today line and two dependency conflicts](docs/gantt-demo.png)

## What it does

Pick one of your GitHub Projects. pm-hub reads its items, field values, milestones, sub-issues and "blocked by" links, then shows:

| View | What you see |
|---|---|
| Overview | Counts, how the project's fields were interpreted, open epics with progress |
| Gantt | Epics as bars in swimlanes, release markers, conflict flags. Drag to move or resize, drag a story onto another epic, draw a dependency between bars, rename in place, add stories |
| Plan | An editable table of epics and their stories: inline cells, multi-select bulk edits, copy and paste between cells |
| Releases | One column per milestone or iteration, with what ships and how much is done |
| Schedule | Calendar of due dates, sprint starts and epic starts and ends |
| Progress | Each epic's work done against how much of its time has passed |
| Status & workload | Status counts, open work per person per week, items missing dates or owners |
| Burn-up | Scope and completed work per week, throughput, projected finish |
| Release confidence | Monte Carlo forecast: chance of hitting each due date, plus the dates half and 85% of runs finish by |
| Dependencies | Graph of blocked-by and parent links, critical path, cycles |
| Settings | Change how dates, epics, swimlanes, releases and priority are read; fiscal-year quarters |
| Review | Every pending change with before and after, checked against GitHub, then applied |

### Works with any project

pm-hub detects how a project is set up and lets you change it:

- **Bar dates:** a start/end date-field pair, an iteration field, or the milestone due date. Epics without dates use the span of their sub-issues.
- **Epics:** issues with sub-issues, the issue type "Epic", or a label like `type: epic`.
- **Swimlanes:** any single-select field, or a label prefix such as `product:`. GitHub Projects itself can't group by labels.
- **Releases:** milestones, an iteration field, or a single-select field.

## Changing the plan

Epics and stories change all the time: they get re-dated, re-scoped, split, moved between epics and blocked by new work. pm-hub is built so that keeping up is quick and safe.

- **Edit anywhere.** The item drawer edits every field (title, status, priority, lane, release, sprint, owners, labels, dates, parent epic, blockers) and can close, split, promote to epic or add a story. The Gantt and the Plan table edit in place. **Ctrl/Cmd+K** opens a command menu that acts on whatever is selected; `[` and `]` shift the selection a week.
- **Dependents follow.** When you move a bar, items blocked by it move only if they would overlap (default), keep their gap, or stay put.
- **Every edit is a recorded change.** Undo and redo with Ctrl+Z and Ctrl+Shift+Z. The counter in the top bar shows net changes (dragging a bar ten times is one change). "GitHub only" hides your changes.
- **Scenarios.** Keep several versions of the plan side by side ("Plan A: hire earlier", "Plan B: cut scope"), each with its own history.
- **Review, then apply.** *Review* lists every change with before and after. pm-hub first re-reads the affected items: anything someone changed on GitHub in the meantime is flagged and left out unless you choose to overwrite it. When a target date moves more than three days you can say why, and the reason is posted as a comment on the issue. You can also post a project status update. Each change reports applied, failed or skipped; failures stay in your draft to retry, and *Prepare a revert* queues the exact undo.
- Lane order and parking stay in pm-hub; GitHub has no place for them.

## How the forecasts work

- **Progress** compares the share of an epic's sub-issues that are closed with the share of its time window that has passed. More than 10 points behind the clock is *Behind*; more than 25 is *At risk*.
- **Burn-up** projects the remaining work at the average pace of the last six full weeks. Epics are left out because they close when their parts do.
- **Release confidence** replays the last 12 weeks of throughput 10,000 times in random order (seeded, so results are repeatable) and reports how often the open work finishes by each due date. A release also carries the open work of every release due before it, because the same team does that work first. Thin history is flagged.
- **Critical path** is the longest chain of open work through "blocked by" links, weighted by remaining days. Loops where items block each other are found with Tarjan's algorithm.

![Release confidence for the demo project](docs/confidence-demo.png)

## Your token and your data

- Create a **classic** personal access token with `project` and `repo`, plus `read:org` for organization projects. [This link pre-fills those scopes.](https://github.com/settings/tokens/new?scopes=project,repo,read:org&description=pm-hub) A token with only `read:project` works for planning, but can't apply changes.
- The token is sent **only** to `api.github.com`, in a request header. A Content-Security-Policy in the built page blocks every other destination except Google Fonts.
- By default the token is kept in `sessionStorage` and forgotten when you close the tab. "Remember on this device" keeps it in `localStorage`.
- Project data is cached in your browser's IndexedDB so the next visit is instant. There is no server, no database and no analytics.
- pm-hub writes to GitHub **only** when you press Apply on the review screen. Every write lives in `src/github/mutations.ts` and is sent only by `src/github/apply.ts`; `test/write-guard.test.ts` enforces both.
- Loading a project costs about 35 GraphQL points per 100 items, out of GitHub's 5,000 per hour. A warning appears when fewer than 500 remain.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173/pm-hub/
npm test           # unit tests on a synthetic project (src/demo/fixture.ts)
npm run build      # typecheck + production build into dist/
```

Optional check against a real project. It loads the project, renders every view in memory, prints a summary and writes nothing to disk:

```bash
PM_HUB_TOKEN=$(gh auth token) PM_HUB_PROJECT=owner/number npx vitest run test/live.test.tsx --silent=false
```

To test real writes, point a separate check at a throwaway project titled exactly "pm-hub sandbox" (it refuses any other). It applies one change of every kind, reads them back, then reverts them all:

```bash
PM_HUB_TOKEN=$(gh auth token) PM_HUB_SANDBOX=owner/number npx vitest run test/live-write.test.ts --silent=false
```

Tests, screenshots and the demo use synthetic data only. Never commit real project snapshots.

## Layout

```
src/github/   GraphQL client, queries, loader, mutations and the apply engine
src/model/    pure logic: normalize, mapping, schedule, health, forecast, deps,
              ops (the change list), edits (intentions to ops), scenarios
src/views/    one component per view
src/ui/       design tokens, shell, drawer, SVG charts
src/demo/     synthetic fixture used by tests and demo mode
```

Pushing to `main` deploys to GitHub Pages (`.github/workflows/pages.yml`). Every PR runs typecheck, tests and a build (`.github/workflows/ci.yml`).

## License

MIT
