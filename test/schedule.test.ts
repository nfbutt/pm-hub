import { describe, expect, it } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { detectMapping } from "../src/model/mapping";
import { normalizeProject } from "../src/model/normalize";
import { buildSchedule, emptyDraft, findConflicts, ganttRows, ownBar, releaseColumns, timeWindow } from "../src/model/schedule";
import { parseCsv, rowsToCsv } from "../src/model/export";

const ANCHOR = "2026-10-19";
const load = () => { const f = makeFixture(ANCHOR); return normalizeProject(DEMO_OWNER, f.meta, f.items, ANCHOR + "T12:00:00Z"); };
const p = load();
const m = detectMapping(p);
const epic = (title: string) => p.items.find(i => i.title === title)!;

describe("bars", () => {
  it("uses the date fields when present", () => {
    const b = ownBar(epic("Billing and invoices"), m)!;
    expect(b).toMatchObject({ source: "fields", start: "2026-09-14", end: "2026-11-08", deadlineOnly: false });
  });

  it("falls back to the iteration, then the milestone due date", () => {
    const undated = p.items.find(i => i.issueType === "Task" && !i.fields["Start date"])!;
    expect(ownBar(undated, m)?.source).toBe("iteration");
    expect(ownBar(undated, { ...m, iterationField: null })?.source).toBe("milestone");
    expect(ownBar(undated, { ...m, iterationField: null, milestoneDates: false })).toBeNull();
  });

  it("rolls an epic up from its children when it has no dates of its own", () => {
    const e = epic("Usage-based pricing engine");
    delete e.fields["Start date"]; delete e.fields["Target date"];
    const s = buildSchedule(p, m);
    const kids = s.children.get(e.key)!.map(c => s.bars.get(c.key)!).filter(Boolean);
    const bar = s.bars.get(e.key)!;
    expect(bar.source).toBe("children");
    expect(bar.start).toBe(kids.map(k => k.start).sort()[0]);
    expect(bar.end).toBe(kids.map(k => k.end).sort().at(-1));
  });

  it("lets the draft override any bar", () => {
    const e = epic("Offline mode");
    const s = buildSchedule(p, m, { ...emptyDraft(), bars: { [e.key]: { start: "2027-01-04", end: "2027-02-26" } } });
    expect(s.bars.get(e.key)).toMatchObject({ source: "draft", start: "2027-01-04", end: "2027-02-26" });
  });
});

describe("conflicts", () => {
  it("flags open items that start before an open blocker finishes", () => {
    const c = findConflicts(buildSchedule(load(), m));
    const titles = c.map(x => load().items.find(i => i.key === x.key)!.title).sort();
    expect(titles).toEqual(["Audit log and exports", "Public REST API v2"]);
  });

  it("clears when the draft moves the blocked epic after its blocker", () => {
    const fresh = load();
    const api = fresh.items.find(i => i.title === "Public REST API v2")!;
    const audit = fresh.items.find(i => i.title === "Audit log and exports")!;
    const draft = { ...emptyDraft(), bars: { [api.key]: { start: "2026-12-07", end: "2027-01-29" }, [audit.key]: { start: "2027-02-01", end: "2027-03-05" } } };
    expect(findConflicts(buildSchedule(fresh, m, draft), draft)).toEqual([]);
  });

  it("ignores parked items", () => {
    const fresh = load();
    const api = fresh.items.find(i => i.title === "Public REST API v2")!;
    const audit = fresh.items.find(i => i.title === "Audit log and exports")!;
    const draft = { ...emptyDraft(), parked: [api.key, audit.key] };
    expect(findConflicts(buildSchedule(fresh, m, draft), draft)).toEqual([]);
  });
});

describe("gantt rows and releases", () => {
  it("groups open epics by lane and expands children on request", () => {
    const fresh = load();
    const s = buildSchedule(fresh, m);
    const groups = ganttRows(fresh, m, s, emptyDraft(), { includeClosed: false, expanded: new Set() });
    expect(groups.map(g => g.lane)).toEqual(["api", "mobile", "web"]);
    expect(groups.flatMap(g => g.rows)).toHaveLength(6); // 7 epics, 1 closed
    const target = groups[0]!.rows[0]!.item.key;
    const expanded = ganttRows(fresh, m, s, emptyDraft(), { includeClosed: false, expanded: new Set([target]) });
    expect(expanded[0]!.rows.filter(r => r.depth === 1).length).toBeGreaterThan(0);
  });

  it("follows the draft's order within a lane", () => {
    const fresh = load();
    const s = buildSchedule(fresh, m);
    const before = ganttRows(fresh, m, s, emptyDraft(), { includeClosed: false, expanded: new Set() })[0]!.rows.map(r => r.item.key);
    const draft = { ...emptyDraft(), order: { api: [...before].reverse() } };
    const after = ganttRows(fresh, m, s, draft, { includeClosed: false, expanded: new Set() })[0]!.rows.map(r => r.item.key);
    expect(after).toEqual([...before].reverse());
  });

  it("orders releases by due date and flags items that end after it", () => {
    const fresh = load();
    const cols = releaseColumns(fresh, m, buildSchedule(fresh, m));
    expect(cols.map(c => c.title)).toEqual(["Release 1", "Release 2", "Release 3", "Release 4"]);
    for (const c of cols) for (const late of c.late) expect(buildSchedule(fresh, m).bars.get(late.key)!.end > c.due!).toBe(true);
  });

  it("pads the window to whole weeks starting on Monday", () => {
    const w = timeWindow(buildSchedule(p, m).bars.values(), ANCHOR);
    expect(new Date(w.start + "T00:00:00Z").getUTCDay()).toBe(1);
    expect(new Date(w.end + "T00:00:00Z").getUTCDay()).toBe(0);
  });
});

describe("export", () => {
  it("round-trips titles with commas and quotes through CSV", () => {
    const fresh = load();
    fresh.items.find(i => i.title === "Offline mode")!.title = 'Offline mode, "phase 1"';
    const groups = ganttRows(fresh, m, buildSchedule(fresh, m), emptyDraft(), { includeClosed: false, expanded: new Set() });
    const parsed = parseCsv(rowsToCsv(groups));
    expect(parsed[0]).toEqual(["key", "title", "lane", "order", "start", "end", "source", "moved", "state", "url"]);
    expect(parsed.some(r => r[1] === 'Offline mode, "phase 1"')).toBe(true);
  });
});
