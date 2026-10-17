# pm-hub

Roadmaps, Gantt charts and delivery forecasts for any GitHub Project. It runs entirely in your browser.

**Open it:** https://nfbutt.github.io/pm-hub/ · or [try the demo project](https://nfbutt.github.io/pm-hub/#/demo/overview) without a token.

## What it does

Pick one of your GitHub Projects. pm-hub reads its items, field values, milestones, sub-issues and "blocked by" links, then shows:

| View | What you see | Status |
|---|---|---|
| Overview | Counts, how the project's fields were interpreted, open epics with progress | ✅ |
| Gantt | Epics as bars in swimlanes, release markers, a draft you can drag, conflict flags, CSV export | Phase 2 |
| Releases | One column per milestone/iteration with what ships and how much is done | Phase 2 |
| Schedule | Calendar of due dates, iteration boundaries and item starts/ends | Phase 3 |
| Progress | Each epic's done share against how much of its time has passed | Phase 3 |
| Status & workload | Status counts, open work per person, items missing dates or owners | Phase 3 |
| Burn-up | Scope and completed work per week, throughput, projected finish | Phase 4 |
| Release confidence | Monte Carlo forecast: chance of hitting each due date, P50/P85 dates | Phase 4 |
| Dependencies | Graph of blocked-by and parent links, critical path, cycles | Phase 5 |

### Works with any project

pm-hub detects how a project is set up and lets you change it:

- **Bar dates:** a start/end date-field pair, an iteration field, or the milestone due date. Epics without dates use the span of their sub-issues.
- **Epics:** issues with sub-issues, the issue type "Epic", or a label like `type: epic`.
- **Swimlanes:** any single-select field, or a label prefix such as `product:`. GitHub Projects itself can't group by labels.
- **Releases:** milestones, an iteration field, or a single-select field.

## Your token and your data

- Create a **classic** personal access token with `read:project` and `repo`, plus `read:org` for organization projects. [This link pre-fills those scopes.](https://github.com/settings/tokens/new?scopes=read:project,repo,read:org&description=pm-hub)
- The token is sent **only** to `api.github.com`, in a request header. A Content-Security-Policy in the built page blocks every other destination except Google Fonts.
- By default the token is kept in `sessionStorage` and forgotten when you close the tab. "Remember on this device" keeps it in `localStorage`.
- Project data is cached in your browser's IndexedDB so the next visit is instant. There is no server, no database and no analytics.
- pm-hub v1 is **read-only**. It sends no GraphQL mutations, and `test/readonly.test.ts` enforces that.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173/pm-hub/
npm test           # unit tests on a synthetic project (src/demo/fixture.ts)
npm run build      # typecheck + production build into dist/
```

Optional check against a real project (prints a summary and writes nothing to disk):

```bash
PM_HUB_TOKEN=$(gh auth token) PM_HUB_PROJECT=owner/number npx vitest run test/live.test.ts --silent=false
```

Tests and the demo use synthetic data only. Never commit real project snapshots.

## Layout

```
src/github/   GraphQL client, queries, paginated loader
src/model/    pure logic: normalize, mapping, scheduling, forecasting
src/views/    one component per view
src/demo/     synthetic fixture used by tests and demo mode
```

Pushing to `main` deploys to GitHub Pages (`.github/workflows/pages.yml`). Every PR runs typecheck, tests and a build (`.github/workflows/ci.yml`).

## License

MIT
