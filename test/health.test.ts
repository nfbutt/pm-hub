import { describe, expect, it } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { allEpicHealth, calendarEvents, epicHealth, hygiene, monthGrid, statusCounts, workload } from "../src/model/health";
import { detectMapping } from "../src/model/mapping";
import { normalizeProject, type Item } from "../src/model/normalize";
import { buildSchedule } from "../src/model/schedule";

const TODAY = "2026-10-19";
const f = makeFixture(TODAY);
const p = normalizeProject(DEMO_OWNER, f.meta, f.items, TODAY + "T12:00:00Z");
const m = detectMapping(p);
const s = buildSchedule(p, m);
const epic = (t: string) => p.items.find(i => i.title === t)!;

describe("epicHealth", () => {
  it("marks closed epics done", () => {
    expect(epicHealth(epic("Customer onboarding flow"), m, s, TODAY).health).toBe("done");
  });

  it("marks epics that haven't started yet", () => {
    const h = epicHealth(epic("Offline mode"), m, s, TODAY);
    expect(h.health).toBe("not-started");
    expect(h.pctTime).toBe(0);
  });

  it("compares time passed with work done", () => {
    // Pricing engine: day 29 of 70, so 41% of its time has passed.
    const h = epicHealth(epic("Usage-based pricing engine"), m, s, TODAY);
    expect(h.pctTime).toBe(41);
    expect(h.daysLeft).toBe(41);
    const gap = h.pctTime! - h.pctDone;
    expect(h.health).toBe(gap > 25 ? "at-risk" : gap > 10 ? "behind" : "on-track");
    // Same epic later in its window with no extra work done falls behind, then at risk.
    expect(epicHealth(epic("Usage-based pricing engine"), m, s, "2026-11-02").health).toBe("behind");
    expect(epicHealth(epic("Usage-based pricing engine"), m, s, "2026-11-09").health).toBe("at-risk");
  });

  it("is overdue once the end date has passed with work open", () => {
    expect(epicHealth(epic("Billing and invoices"), m, s, "2026-12-01").health).toBe("overdue");
  });

  it("sorts the riskiest epics first", () => {
    const order = allEpicHealth(p, m, s, TODAY).map(h => h.health);
    const rank = ["overdue", "at-risk", "behind", "on-track", "not-started", "no-dates", "done"];
    expect([...order].sort((a, b) => rank.indexOf(a) - rank.indexOf(b))).toEqual(order);
  });
});

describe("hygiene", () => {
  const h = hygiene(p, m, s, TODAY);
  it("finds open items without dates, owners or a release", () => {
    expect(h.noDates.map(i => i.title)).toContain("Flaky checkout test on CI");
    expect(h.noAssignee.map(i => i.title)).toContain("Flaky checkout test on CI");
    expect(h.noRelease.map(i => i.title)).toContain("Flaky checkout test on CI");
    expect(h.noAssignee.some(i => i.issueType === "Epic")).toBe(false);
  });
  it("finds stale items and links to finished blockers", () => {
    expect(h.stale.map(i => i.title)).toContain("Flaky checkout test on CI");
    expect(h.blockedByClosed.every((i: Item) => i.blockedBy.some(b => !b.open))).toBe(true);
    expect(h.blockedByClosed.length).toBeGreaterThan(0);
  });
});

describe("status and workload", () => {
  it("counts by status in the field's option order", () => {
    const counts = statusCounts(p, m);
    const names = counts.map(c => c.status);
    expect(names.indexOf("Todo")).toBeLessThan(names.indexOf("In Progress"));
    expect(counts.reduce((n, c) => n + c.count, 0)).toBe(p.items.filter(i => i.state === "open").length);
  });

  it("spreads each person's dated items across weeks", () => {
    const weeks = ["2026-10-12", "2026-10-19", "2026-10-26"];
    const load = workload(p, s, weeks);
    expect(load.at(-1)!.login).toBe("Unassigned");
    for (const person of load) expect(person.weekly).toHaveLength(3);
    const total = load.reduce((n, x) => n + x.open.length, 0);
    expect(total).toBeGreaterThanOrEqual(p.items.filter(i => i.state === "open").length);
  });
});

describe("calendar", () => {
  it("lists release due dates once, plus epic starts and ends", () => {
    const ev = calendarEvents(p, m, s, { epicsOnly: true });
    expect(ev.filter(e => e.kind === "release").map(e => e.label)).toEqual(["Release 1", "Release 2", "Release 3", "Release 4"]);
    expect(ev.some(e => e.kind === "end" && e.label === "Offline mode")).toBe(true);
    expect([...ev].map(e => e.date)).toEqual(ev.map(e => e.date).sort());
  });

  it("builds a 6-week month grid starting on Monday", () => {
    const g = monthGrid("2026-10");
    expect(g).toHaveLength(42);
    expect(g[0]).toBe("2026-09-28");
    expect(g).toContain("2026-10-31");
  });
});
