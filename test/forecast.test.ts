import { describe, expect, it } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { burnup, chanceWithin, forecastInputs, linearProjection, mondayOf, monteCarloWeeks, releaseForecasts, weeklyThroughput, weeksUntil, workItems } from "../src/model/forecast";
import { detectMapping } from "../src/model/mapping";
import { normalizeProject } from "../src/model/normalize";

const TODAY = "2026-10-19";
const f = makeFixture(TODAY);
const p = normalizeProject(DEMO_OWNER, f.meta, f.items, TODAY + "T12:00:00Z");
const m = detectMapping(p);

describe("throughput and burn-up", () => {
  it("counts work items only, never epics or drafts", () => {
    const w = workItems(p, m);
    expect(w.some(i => i.issueType === "Epic")).toBe(false);
    expect(w.some(i => i.kind === "draft")).toBe(false);
    expect(w.some(i => i.kind === "pr")).toBe(true);
  });

  it("buckets closures into full past weeks, oldest first", () => {
    const t = weeklyThroughput(workItems(p, m), TODAY, 12);
    expect(t).toHaveLength(12);
    expect(t.at(-1)!.weekStart).toBe("2026-10-12");
    expect(t[0]!.weekStart).toBe("2026-07-27");
    const closedRecently = workItems(p, m).filter(i => i.closedAt && i.closedAt.slice(0, 10) >= "2026-07-27" && i.closedAt.slice(0, 10) < "2026-10-19").length;
    expect(t.reduce((n, x) => n + x.closed, 0)).toBe(closedRecently);
  });

  it("burn-up never decreases and done never exceeds scope", () => {
    const b = burnup(workItems(p, m), TODAY);
    expect(b.length).toBeGreaterThan(5);
    for (let i = 1; i < b.length; i++) {
      expect(b[i]!.scope).toBeGreaterThanOrEqual(b[i - 1]!.scope);
      expect(b[i]!.done).toBeGreaterThanOrEqual(b[i - 1]!.done);
    }
    for (const x of b) expect(x.done).toBeLessThanOrEqual(x.scope);
  });
});

describe("projections", () => {
  it("projects linearly at the average rate", () => {
    expect(linearProjection(10, [2, 2, 2, 2], TODAY)).toEqual({ weeks: 5, date: "2026-11-22", rate: 2 });
    expect(linearProjection(10, [0, 0], TODAY)).toBeNull();
    expect(linearProjection(0, [0], TODAY)?.weeks).toBe(0);
  });

  it("Monte Carlo with constant throughput is exact", () => {
    const mc = monteCarloWeeks(12, [3], { runs: 1000 })!;
    expect([mc.p50, mc.p85, mc.p95]).toEqual([4, 4, 4]);
    expect(chanceWithin(mc, 3)).toBe(0);
    expect(chanceWithin(mc, 4)).toBe(1);
  });

  it("Monte Carlo percentiles are ordered and stable for a fixed seed", () => {
    const a = monteCarloWeeks(30, [0, 1, 2, 3, 5, 8], { seed: 3 })!;
    const b = monteCarloWeeks(30, [0, 1, 2, 3, 5, 8], { seed: 3 })!;
    expect(a).toEqual(b);
    expect(a.p50).toBeLessThanOrEqual(a.p85);
    expect(a.p85).toBeLessThanOrEqual(a.p95);
    // Mean throughput is 19/6 ~ 3.17/week, so the median is close to 30 / 3.17 ~ 9.5 weeks.
    expect(a.p50).toBeGreaterThanOrEqual(8);
    expect(a.p50).toBeLessThanOrEqual(11);
  });

  it("refuses to forecast without any throughput", () => {
    expect(monteCarloWeeks(5, [0, 0, 0])).toBeNull();
    expect(monteCarloWeeks(5, [])).toBeNull();
  });

  it("counts whole weeks to a due date", () => {
    expect(weeksUntil("2026-10-19", "2026-10-25")).toBe(1);
    expect(weeksUntil("2026-10-21", "2026-10-26")).toBe(2);
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
  });
});

describe("release forecasts", () => {
  const inputs = forecastInputs(p, m, TODAY);
  const r = releaseForecasts(p, m, TODAY, inputs);

  it("orders releases by due date and accumulates earlier open work", () => {
    expect(r.map(x => x.title)).toEqual(["Release 1", "Release 2", "Release 3", "Release 4"]);
    for (let i = 1; i < r.length; i++) expect(r[i]!.cumulativeOpen).toBe(r[i - 1]!.cumulativeOpen + r[i]!.open);
  });

  it("gives later releases a lower or equal chance than earlier ones with the same pace", () => {
    const future = r.filter(x => x.due && x.due >= TODAY && x.chance !== null);
    for (let i = 1; i < future.length; i++) {
      const prev = future[i - 1]!, cur = future[i]!;
      if (cur.cumulativeOpen >= prev.cumulativeOpen && cur.due === prev.due) expect(cur.chance!).toBeLessThanOrEqual(prev.chance!);
    }
    for (const x of r) if (x.chance !== null) { expect(x.chance).toBeGreaterThanOrEqual(0); expect(x.chance).toBeLessThanOrEqual(1); }
  });

  it("reports whether history is too thin to trust", () => {
    expect(inputs.samples).toHaveLength(12);
    expect(typeof inputs.thin).toBe("boolean");
    expect(inputs.closedInHistory).toBe(inputs.samples.reduce((a, b) => a + b, 0));
  });
});
