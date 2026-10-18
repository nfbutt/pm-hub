import { describe, expect, it } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { churnAcross, diffBaselines, scopeAddedAfterStart, snapshot, versusBaseline } from "../src/model/diff";
import { moveToParent, newItem, setState, setTitle } from "../src/model/edits";
import { detectMapping } from "../src/model/mapping";
import { normalizeProject, type Project } from "../src/model/normalize";
import { applyOps, datesOp, type Op } from "../src/model/ops";
import { buildSchedule } from "../src/model/schedule";

const TODAY = "2026-10-19";
const f = makeFixture(TODAY);
const base = normalizeProject(DEMO_OWNER, f.meta, f.items, TODAY + "T12:00:00Z");
const m = detectMapping(base);
const t = (title: string) => base.items.find(i => i.title === title)!;
const offline = t("Offline mode"), pricing = t("Usage-based pricing engine");
const snap = (p: Project, name: string, at: string) => snapshot(p, m, buildSchedule(p, m), name, false, at);

describe("baselines", () => {
  it("records every item with its window, release and lane", () => {
    const b = snap(base, "start", "2026-10-01T00:00:00Z");
    expect(b.items).toHaveLength(base.items.length);
    expect(b.items.find(i => i.key === offline.key)).toMatchObject({ epic: true, lane: "mobile", start: "2026-11-30", end: "2027-01-24" });
  });

  it("diffs added, removed, moved, re-parented, closed and renamed items", () => {
    const story = base.items.find(i => i.parentKey === pricing.key && i.state === "open")!;
    const ops: Op[] = [
      datesOp(offline, m, "2026-12-14", "2027-02-21"),
      ...moveToParent(base, story, offline.key),
      ...setState(t("Public REST API v2"), "closed"),
      ...setTitle(pricing, "Pricing engine"),
      ...newItem(base, m, "Sync conflicts", { parentKey: offline.key }),
      { kind: "archive", key: t("Audit log and exports").key },
    ];
    const after = applyOps(base, ops).project;
    const d = diffBaselines(snap(base, "a", "2026-10-01T00:00:00Z"), snap(after, "b", "2026-10-15T00:00:00Z"));
    expect(d.added.map(i => i.title)).toEqual(["Sync conflicts"]);
    expect(d.removed.map(i => i.title)).toEqual(["Audit log and exports"]);
    expect(d.reparented).toEqual([expect.objectContaining({ from: pricing.key, to: offline.key })]);
    expect(d.moved.find(x => x.key === offline.key)).toMatchObject({ fromEnd: "2027-01-24", toEnd: "2027-02-21", days: 28 });
    expect(d.closed.map(i => i.title)).toEqual(["Public REST API v2"]);
    expect(d.renamed).toEqual([expect.objectContaining({ from: "Usage-based pricing engine" })]);
  });

  it("counts slips across several baselines", () => {
    const b1 = snap(base, "1", "2026-09-01T00:00:00Z");
    const p2 = applyOps(base, [datesOp(offline, m, "2026-12-07", "2027-01-31")]).project;
    const p3 = applyOps(p2, [datesOp(p2.items.find(i => i.key === offline.key)!, m, "2026-12-07", "2027-02-14")]).project;
    const churn = churnAcross([snap(p3, "3", "2026-10-01T00:00:00Z"), b1, snap(p2, "2", "2026-09-15T00:00:00Z")]);
    expect(churn[0]).toMatchObject({ key: offline.key, endMoves: 2, slipDays: 21, firstEnd: "2027-01-24", lastEnd: "2027-02-14" });
    expect(churn.some(c => c.key === pricing.key)).toBe(false);
  });

  it("compares a current end date with a baseline", () => {
    const b = snap(base, "1", "2026-09-01T00:00:00Z");
    expect(versusBaseline(b, offline.key, "2027-01-31")).toBe(7);
    expect(versusBaseline(b, "nope", "2027-01-31")).toBeNull();
  });
});

describe("scope added after start", () => {
  it("counts sub-issues created after their epic started", () => {
    const withNew = applyOps(base, newItem(base, m, "Late addition", { parentKey: pricing.key })).project;
    // New items carry no creation date until they exist on GitHub, so give it one after the start.
    withNew.items.find(i => i.title === "Late addition")!.createdAt = "2026-10-10T00:00:00Z";
    const counts = scopeAddedAfterStart(withNew, m, buildSchedule(withNew, m));
    expect(counts.get(pricing.key)).toBeGreaterThanOrEqual(1);
  });
});
