// Optional check against a real project. Skipped unless a token is supplied:
//   PM_HUB_TOKEN=$(gh auth token) PM_HUB_PROJECT=owner/number npx vitest run test/live.test.ts
// Prints a summary only; never writes project data to disk.
import { describe, expect, it } from "vitest";
import { createClient } from "../src/github/client";
import { loadProject, loadViewerProjects } from "../src/github/load";
import { detectMapping, isEpic, laneOf } from "../src/model/mapping";

const token = process.env.PM_HUB_TOKEN;
const target = process.env.PM_HUB_PROJECT ?? "";

describe.skipIf(!token)("live GitHub project", () => {
  it("loads every item and detects a usable mapping", async () => {
    const client = createClient(token!);
    const { projects } = await loadViewerProjects(client);
    const [owner, num] = target.includes("/") ? target.split("/") : [projects[0]!.owner, String(projects[0]!.number)];
    const summary = projects.find(p => p.owner === owner && p.number === Number(num));
    const p = await loadProject(client, owner!, Number(num));
    const m = detectMapping(p);
    const epics = p.items.filter(i => isEpic(i, m));
    const lanes: Record<string, number> = {};
    for (const e of epics.filter(e => e.state === "open")) { const l = laneOf(e, m) ?? "none"; lanes[l] = (lanes[l] ?? 0) + 1; }
    console.log({
      project: p.title, items: p.items.length, expected: summary?.itemCount,
      openEpics: epics.filter(e => e.state === "open").length, lanes, mapping: m,
      withParent: p.items.filter(i => i.parentKey).length, withBlockedBy: p.items.filter(i => i.blockedBy.length).length,
      rateLimit: client.state.rateLimit,
    });
    expect(p.items.length).toBeGreaterThan(0);
    if (summary) expect(p.items.length).toBeLessThanOrEqual(summary.itemCount);
  }, 120_000);
});
