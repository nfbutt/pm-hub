// Optional check against a real project. Skipped unless a token is supplied:
//   PM_HUB_TOKEN=$(gh auth token) PM_HUB_PROJECT=owner/number npx vitest run test/live.test.tsx --silent=false
// Loads the project, renders every view in memory, prints a summary. Never writes project data to disk.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createClient } from "../src/github/client";
import { loadProject, loadViewerProjects } from "../src/github/load";
import { forecastInputs, releaseForecasts } from "../src/model/forecast";
import { allEpicHealth, hygiene } from "../src/model/health";
import { detectMapping, isEpic, laneOf } from "../src/model/mapping";
import { buildSchedule, emptyDraft, findConflicts } from "../src/model/schedule";
import { defaultPrefs } from "../src/store/cache";
import { BurnUp } from "../src/views/BurnUp";
import { Confidence } from "../src/views/Confidence";
import { Dependencies } from "../src/views/Dependencies";
import { Gantt } from "../src/views/Gantt";
import { Overview } from "../src/views/Overview";
import { Progress } from "../src/views/Progress";
import { Releases } from "../src/views/Releases";
import { Schedule } from "../src/views/Schedule";
import { Settings } from "../src/views/Settings";
import { Workload } from "../src/views/Workload";

const token = process.env.PM_HUB_TOKEN;
const target = process.env.PM_HUB_PROJECT ?? "";
const noop = () => {};
const today = new Date().toISOString().slice(0, 10);

describe.skipIf(!token)("live GitHub project", () => {
  it("loads every item, detects a mapping and renders every view", async () => {
    const client = createClient(token!);
    const { projects } = await loadViewerProjects(client);
    const [owner, num] = target.includes("/") ? target.split("/") : [projects[0]!.owner, String(projects[0]!.number)];
    const summary = projects.find(p => p.owner === owner && p.number === Number(num));
    const p = await loadProject(client, owner!, Number(num));
    const m = detectMapping(p);
    const s = buildSchedule(p, m);
    const epics = p.items.filter(i => isEpic(i, m));
    const lanes: Record<string, number> = {};
    for (const e of epics.filter(e => e.state === "open")) { const l = laneOf(e, m) ?? "none"; lanes[l] = (lanes[l] ?? 0) + 1; }
    const health = allEpicHealth(p, m, s, today).reduce<Record<string, number>>((a, h) => { a[h.health] = (a[h.health] ?? 0) + 1; return a; }, {});
    const hyg = Object.fromEntries(Object.entries(hygiene(p, m, s, today)).map(([k, v]) => [k, v.length]));
    const inputs = forecastInputs(p, m, today);
    const releases = releaseForecasts(p, m, today, inputs).map(r => `${r.title}: ${r.open} open, ${r.chance === null ? "n/a" : Math.round(r.chance * 100) + "%"}`);

    const views: [string, JSX.Element][] = [
      ["overview", <Overview project={p} mapping={m} />],
      ["gantt", <Gantt project={p} mapping={m} draft={emptyDraft()} changed={0} prefs={defaultPrefs} setPrefs={noop} />],
      ["releases", <Releases project={p} mapping={m} draft={emptyDraft()} />],
      ["schedule", <Schedule project={p} mapping={m} draft={emptyDraft()} />],
      ["progress", <Progress project={p} mapping={m} draft={emptyDraft()} />],
      ["workload", <Workload project={p} mapping={m} draft={emptyDraft()} />],
      ["burnup", <BurnUp project={p} mapping={m} />],
      ["confidence", <Confidence project={p} mapping={m} />],
      ["dependencies", <Dependencies project={p} mapping={m} draft={emptyDraft()} />],
      ["settings", <Settings project={p} mapping={m} setMapping={noop} resetMapping={noop} prefs={defaultPrefs} setPrefs={noop} aiHref="#/ai" />],
    ];
    const rendered: Record<string, number> = {};
    for (const [name, el] of views) rendered[name] = renderToString(el).length;

    console.log({
      project: p.title, items: p.items.length, expected: summary?.itemCount, openEpics: epics.filter(e => e.state === "open").length, lanes,
      bars: s.bars.size, conflicts: findConflicts(s).length, health, hygiene: hyg,
      throughput: inputs.samples.join(" "), releases, renderedBytes: rendered, rateLimit: client.state.rateLimit,
    });
    expect(p.items.length).toBeGreaterThan(0);
    for (const [name, bytes] of Object.entries(rendered)) expect(bytes, name).toBeGreaterThan(200);
  }, 180_000);
});
