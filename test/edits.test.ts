import { describe, expect, it } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import {
  addBlocker, laneOptions, milestoneOptions, moveToParent, newItem, promoteToEpic, setDatesWithDependents, setLane,
  setOption, setState, setTitle, shiftDates, splitItem,
} from "../src/model/edits";
import { detectMapping, laneOf } from "../src/model/mapping";
import { normalizeProject, type Project } from "../src/model/normalize";
import { applyOps } from "../src/model/ops";
import { buildSchedule } from "../src/model/schedule";

const TODAY = "2026-10-19";
const load = (): Project => { const f = makeFixture(TODAY); return normalizeProject(DEMO_OWNER, f.meta, f.items, TODAY + "T12:00:00Z"); };
const p = load();
const m = detectMapping(p);
const t = (title: string) => p.items.find(i => i.title === title)!;
const pricing = t("Usage-based pricing engine"), api = t("Public REST API v2"), audit = t("Audit log and exports"), offline = t("Offline mode");
const barOf = (proj: Project, key: string) => buildSchedule(proj, m).bars.get(key)!;

describe("dependent shifting", () => {
  // In the fixture, API v2 is blocked by Pricing, and Audit log is blocked by API v2.
  const before = barOf(p, pricing.key);
  const later = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

  it("keep-gap moves the whole chain by the same amount", () => {
    const ops = setDatesWithDependents(p, m, pricing.key, later(before.start, 14), later(before.end, 14), "keep-gap");
    expect(ops.map(o => ("key" in o ? o.key : ""))).toEqual([pricing.key, api.key, audit.key]);
    const after = applyOps(p, ops).project;
    expect(barOf(after, api.key).start).toBe(later(barOf(p, api.key).start, 14));
    expect(barOf(after, audit.key).end).toBe(later(barOf(p, audit.key).end, 14));
  });

  it("on-overlap only pushes dependents that would start before the blocker ends", () => {
    const ops = setDatesWithDependents(p, m, pricing.key, later(before.start, 14), later(before.end, 14), "on-overlap");
    const after = applyOps(p, ops).project;
    for (const k of ops.slice(1).map(o => ("key" in o ? o.key : ""))) {
      const blocker = after.items.find(i => i.key === k)!.blockedBy[0]!.key;
      expect(barOf(after, k).start > barOf(after, blocker).end).toBe(true);
    }
  });

  it("none moves only the item itself", () => {
    expect(setDatesWithDependents(p, m, pricing.key, later(before.start, 14), later(before.end, 14), "none")).toHaveLength(1);
  });

  it("shifts several items keeping their length", () => {
    const ops = shiftDates(p, m, [offline.key, audit.key], 7);
    const after = applyOps(p, ops).project;
    expect(barOf(after, offline.key).start).toBe(later(barOf(p, offline.key).start, 7));
    expect(barOf(after, offline.key).end).toBe(later(barOf(p, offline.key).end, 7));
  });
});

describe("field edits", () => {
  it("sets single-select fields by option name and ignores unknown options", () => {
    expect(setOption(p, offline, "Priority", "High")[0]).toMatchObject({ kind: "setField", field: "Priority", after: { name: "High", optionId: "p1" } });
    expect(setOption(p, offline, "Priority", "Whenever")).toEqual([]);
    expect(setOption(p, offline, "Priority", "Low")).toEqual([]); // already Low
  });

  it("changes lane by swapping the prefixed label", () => {
    const ops = setLane(p, m, offline, "web");
    expect(ops).toHaveLength(1);
    expect(laneOf(applyOps(p, ops).project.items.find(i => i.key === offline.key)!, m)).toBe("web");
    expect(laneOptions(p, m)).toEqual(["api", "mobile", "web"]);
    expect(setLane(p, m, offline, "mobile")).toEqual([]);
  });

  it("titles and states ignore no-op edits", () => {
    expect(setTitle(offline, "  Offline mode ")).toEqual([]);
    expect(setTitle(offline, "Offline sync")).toHaveLength(1);
    expect(setState(offline, "open")).toEqual([]);
    expect(setState(offline, "closed", "NOT_PLANNED")[0]).toMatchObject({ after: { state: "closed", reason: "NOT_PLANNED" } });
  });

  it("lists one repo's milestones by due date", () => {
    expect(milestoneOptions(p, "demo-co/orbit").map(x => x.title)).toEqual(["Release 1", "Release 2", "Release 3", "Release 4"]);
  });
});

describe("structure edits", () => {
  const story = p.items.find(i => i.parentKey === pricing.key)!;

  it("moves a story to another epic but refuses loops", () => {
    expect(moveToParent(p, story, offline.key)).toEqual([{ kind: "setParent", key: story.key, before: pricing.key, after: offline.key }]);
    expect(moveToParent(p, pricing, story.key)).toEqual([]);
    expect(moveToParent(p, story, pricing.key)).toEqual([]);
  });

  it("adds a blocker but refuses one that would make a loop", () => {
    expect(addBlocker(p, offline, pricing.key)).toHaveLength(1);
    expect(addBlocker(p, pricing, audit.key)).toEqual([]); // audit is (transitively) blocked by pricing
    expect(addBlocker(p, api, pricing.key)).toEqual([]);   // already there
  });

  it("creates a story under an epic with the epic's lane", () => {
    const [op] = newItem(p, m, "Conflict resolution", { parentKey: offline.key });
    expect(op).toMatchObject({ kind: "create", item: { title: "Conflict resolution", parentKey: offline.key, repo: "demo-co/orbit" } });
    const created = applyOps(p, [op!]).project.items.find(i => i.title === "Conflict resolution")!;
    expect(laneOf(created, m)).toBe("mobile");
  });

  it("splits an epic, moving the chosen sub-issues to the new one", () => {
    const kids = p.items.filter(i => i.parentKey === offline.key).slice(0, 3).map(i => i.key);
    const ops = splitItem(p, m, offline, "Offline mode, phase 2", kids);
    expect(ops[0]!.kind).toBe("create");
    const after = applyOps(p, ops).project;
    const phase2 = after.items.find(i => i.title === "Offline mode, phase 2")!;
    expect(after.items.filter(i => i.parentKey === phase2.key).map(i => i.key).sort()).toEqual([...kids].sort());
    expect(after.items.find(i => i.key === offline.key)!.subIssues!.total).toBe(offline.subIssues!.total - 3);
  });

  it("promotes a story to an epic with the project's epic label", () => {
    const ops = promoteToEpic(m, story);
    expect(ops[0]).toMatchObject({ kind: "setLabels" });
    const after = applyOps(p, ops).project.items.find(i => i.key === story.key)!;
    expect(after.labels).toContain("type: epic");
    expect(after.labels).not.toContain("type: story");
  });
});
