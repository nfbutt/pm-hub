import { describe, expect, it } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { detectMapping } from "../src/model/mapping";
import { normalizeProject, type Project } from "../src/model/normalize";
import { applyOps, datesOp, describe as describeOp, inverse, netOps, newKey, type Op } from "../src/model/ops";
import {
  activeOps, activeScenario, addScenario, canRedo, canUndo, clearActive, discardItem, emptyStore, migrateLegacyDraft,
  record, redo, removeScenario, switchScenario, undo,
} from "../src/model/scenarios";
import { buildSchedule, emptyDraft } from "../src/model/schedule";

const TODAY = "2026-10-19";
const load = (): Project => { const f = makeFixture(TODAY); return normalizeProject(DEMO_OWNER, f.meta, f.items, TODAY + "T12:00:00Z"); };
const base = load();
const m = detectMapping(base);
const byTitle = (p: Project, t: string) => p.items.find(i => i.title === t)!;
const epic = byTitle(base, "Offline mode");
const pricing = byTitle(base, "Usage-based pricing engine");
const story = base.items.find(i => i.parentKey === pricing.key && i.state === "open")!;
const titleOf = (k: string) => base.items.find(i => i.key === k)?.title ?? k;

// One sample of every op kind against the fixture.
const SAMPLES = (): Op[] => [
  datesOp(epic, m, "2027-01-04", "2027-02-26"),
  { kind: "setField", key: epic.key, field: "Status", before: epic.fields["Status"] ?? null, after: { kind: "single", name: "In Progress", optionId: "st2" } },
  { kind: "setTitle", key: epic.key, before: epic.title, after: "Offline mode v1" },
  { kind: "setState", key: story.key, before: { state: "open", reason: null }, after: { state: "closed", reason: "NOT_PLANNED" } },
  { kind: "setParent", key: story.key, before: pricing.key, after: epic.key },
  { kind: "setLabels", key: epic.key, before: epic.labels, after: [...epic.labels, "risky"] },
  { kind: "setMilestone", key: story.key, before: story.milestone, after: null },
  { kind: "setAssignees", key: story.key, before: story.assignees, after: ["zoe"] },
  { kind: "addBlockedBy", key: epic.key, blocker: pricing.key },
  { kind: "park", key: epic.key, before: false, after: true },
  { kind: "reorder", lane: "mobile", before: [], after: [epic.key] },
];

describe("applyOps", () => {
  it("never mutates the GitHub snapshot", () => {
    const before = JSON.stringify(base);
    applyOps(base, SAMPLES());
    expect(JSON.stringify(base)).toBe(before);
  });

  it("applies every op kind", () => {
    const { project: p, local } = applyOps(base, SAMPLES());
    const e = p.items.find(i => i.key === epic.key)!, s = p.items.find(i => i.key === story.key)!;
    expect(e.fields["Start date"]).toEqual({ kind: "date", date: "2027-01-04" });
    expect(e.fields["Target date"]).toEqual({ kind: "date", date: "2027-02-26" });
    expect(e.fields["Status"]).toMatchObject({ name: "In Progress" });
    expect(e.title).toBe("Offline mode v1");
    expect(e.labels).toContain("risky");
    expect(e.blockedBy.map(b => b.key)).toContain(pricing.key);
    expect(s.state).toBe("closed");
    expect(s.stateReason).toBe("NOT_PLANNED");
    expect(s.parentKey).toBe(epic.key);
    expect(s.milestone).toBeNull();
    expect(s.assignees).toEqual(["zoe"]);
    expect(local.parked).toEqual([epic.key]);
    expect(local.order["mobile"]).toEqual([epic.key]);
  });

  it("keeps sub-issue counts right when a story moves to another epic", () => {
    const { project: p } = applyOps(base, [{ kind: "setParent", key: story.key, before: pricing.key, after: epic.key }]);
    expect(p.items.find(i => i.key === pricing.key)!.subIssues!.total).toBe(pricing.subIssues!.total - 1);
    expect(p.items.find(i => i.key === epic.key)!.subIssues!.total).toBe(epic.subIssues!.total + 1);
  });

  it("re-rolls an undated epic from its children's edited dates", () => {
    const p0 = structuredClone(base);
    const e = p0.items.find(i => i.key === pricing.key)!;
    delete e.fields["Start date"]; delete e.fields["Target date"];
    const kid = p0.items.find(i => i.parentKey === pricing.key && i.fields["Target date"])!;
    const { project } = applyOps(p0, [datesOp(kid, m, "2026-09-01", "2027-06-30")]);
    const bar = buildSchedule(project, m).bars.get(pricing.key)!;
    expect(bar.source).toBe("children");
    expect(bar.end).toBe("2027-06-30");
  });

  it("creates new items under a parent", () => {
    const key = newKey();
    const { project: p } = applyOps(base, [{ kind: "create", key, item: { title: "Sync conflicts", repo: "demo-co/orbit", parentKey: epic.key, labels: ["type: story"], fields: {} } }]);
    expect(p.items.find(i => i.key === key)).toMatchObject({ title: "Sync conflicts", parentKey: epic.key, state: "open" });
    expect(p.items.find(i => i.key === epic.key)!.subIssues!.total).toBe(epic.subIssues!.total + 1);
  });

  it("keeps dates locally when the project has no field to hold them", () => {
    const noStart = { ...m, startField: null };
    const { project: p, local, unsavableDates } = applyOps(base, [datesOp(epic, noStart, "2027-01-04", "2027-02-26")]);
    expect(p.items.find(i => i.key === epic.key)!.fields["Target date"]).toEqual({ kind: "date", date: "2027-02-26" });
    expect(local.bars[epic.key]).toEqual({ start: "2027-01-04", end: "2027-02-26" });
    expect(unsavableDates.has(epic.key)).toBe(true);
  });

  it("hides archived items", () => {
    const { project: p } = applyOps(base, [{ kind: "archive", key: epic.key }]);
    expect(p.items.some(i => i.key === epic.key)).toBe(false);
  });
});

describe("inverse", () => {
  it("undoes every op kind when applied after it", () => {
    for (const op of SAMPLES()) {
      if (op.kind === "park" || op.kind === "reorder") continue;
      const there = applyOps(base, [op]).project;
      const back = applyOps(there, [inverse(op)]).project;
      const strip = (p: Project) => p.items.filter(i => i.key === ("key" in op ? op.key : "")).map(i => ({ ...i, closedAt: null }));
      expect(strip(back), op.kind).toEqual(strip(base));
    }
  });

  it("pairs add/remove and create/archive", () => {
    expect(inverse({ kind: "addBlockedBy", key: "a", blocker: "b" })).toEqual({ kind: "removeBlockedBy", key: "a", blocker: "b" });
    expect(inverse({ kind: "create", key: "new:x", item: { title: "x", repo: null, parentKey: null, labels: [], fields: {} } })).toEqual({ kind: "archive", key: "new:x" });
  });
});

describe("netOps", () => {
  it("folds repeated edits to one change from the first before to the last after", () => {
    const a = datesOp(epic, m, "2027-01-04", "2027-02-26");
    const moved = applyOps(base, [a]).project.items.find(i => i.key === epic.key)!;
    const b = datesOp(moved, m, "2027-01-11", "2027-03-05");
    const net = netOps([a, b]);
    expect(net).toHaveLength(1);
    expect(net[0]).toMatchObject({ before: a.kind === "setDates" ? a.before : null, after: { start: "2027-01-11", end: "2027-03-05" } });
  });

  it("drops edits that end where they started", () => {
    const a = datesOp(epic, m, "2027-01-04", "2027-02-26");
    const moved = applyOps(base, [a]).project.items.find(i => i.key === epic.key)!;
    const back = datesOp(moved, m, a.kind === "setDates" ? a.before.start! : "", a.kind === "setDates" ? a.before.end! : "");
    expect(netOps([a, back])).toEqual([]);
  });

  it("cancels add-then-remove of the same dependency, and never creates an item archived in the same draft", () => {
    expect(netOps([{ kind: "addBlockedBy", key: "a", blocker: "b" }, { kind: "removeBlockedBy", key: "a", blocker: "b" }])).toEqual([]);
    const key = newKey();
    expect(netOps([{ kind: "create", key, item: { title: "x", repo: null, parentKey: null, labels: [], fields: {} } }, { kind: "archive", key }])).toEqual([]);
  });
});

describe("scenarios", () => {
  const op = datesOp(epic, m, "2027-01-04", "2027-02-26");

  it("records, undoes and redoes one action at a time", () => {
    let st = record(emptyStore(), "Moved Offline mode", [op]);
    expect(activeOps(activeScenario(st))).toHaveLength(1);
    st = undo(st);
    expect(activeOps(activeScenario(st))).toHaveLength(0);
    expect(canRedo(st)).toBe(true);
    st = redo(st);
    expect(activeOps(activeScenario(st))).toHaveLength(1);
    expect(canUndo(st)).toBe(true);
  });

  it("drops the redo tail when a new change is recorded", () => {
    let st = record(record(emptyStore(), "a", [op]), "b", [op]);
    st = record(undo(st), "c", [op]);
    expect(activeScenario(st).changes.map(c => c.label)).toEqual(["a", "c"]);
  });

  it("keeps scenarios independent and can copy one", () => {
    let st = record(emptyStore(), "a", [op]);
    const first = st.active;
    st = addScenario(st, "Plan B", first);
    expect(activeOps(activeScenario(st))).toHaveLength(1);
    st = clearActive(st);
    expect(activeOps(activeScenario(st))).toHaveLength(0);
    st = switchScenario(st, first);
    expect(activeOps(activeScenario(st))).toHaveLength(1);
    st = removeScenario(st, first);
    expect(st.scenarios).toHaveLength(1);
    expect(st.scenarios[0]!.name).toBe("Plan B");
  });

  it("discards every change to one item", () => {
    let st = record(emptyStore(), "a", [op, { kind: "setTitle", key: story.key, before: story.title, after: "x" }]);
    st = record(st, "b", [{ kind: "addBlockedBy", key: story.key, blocker: epic.key }]);
    st = discardItem(st, epic.key);
    expect(activeOps(activeScenario(st)).map(o => o.kind)).toEqual(["setTitle"]);
  });

  it("migrates a v1 draft", () => {
    const st = migrateLegacyDraft({ ...emptyDraft(), bars: { [epic.key]: { start: "2027-01-04", end: "2027-02-26" } }, parked: [pricing.key], order: { api: [pricing.key] } }, base, m);
    expect(activeOps(activeScenario(st)).map(o => o.kind).sort()).toEqual(["park", "reorder", "setDates"]);
  });
});

describe("describe", () => {
  it("says what changed in plain words", () => {
    expect(describeOp({ kind: "setParent", key: story.key, before: pricing.key, after: epic.key }, titleOf)).toBe(`${story.title}: moved from Usage-based pricing engine to Offline mode`);
    expect(describeOp(datesOp(epic, m, "2027-01-04", "2027-02-26"), titleOf)).toMatch(/^Offline mode: dates .+ → Jan 4 – Feb 26$/);
  });
});
