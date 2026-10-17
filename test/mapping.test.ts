import { describe, expect, it } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { detectMapping, isEpic, laneOf, priorityOf, releaseOf, splitPrefixed } from "../src/model/mapping";
import { normalizeProject, type Project } from "../src/model/normalize";

const base = (): Project => {
  const f = makeFixture("2026-10-19");
  return normalizeProject(DEMO_OWNER, f.meta, f.items, "2026-10-19T12:00:00Z");
};

describe("detectMapping", () => {
  it("finds date fields, epics, lanes, releases, status and priority on the fixture", () => {
    const m = detectMapping(base());
    expect(m.startField).toBe("Start date");
    expect(m.endField).toBe("Target date");
    expect(m.iterationField).toBe("Sprint");
    expect(m.epic).toEqual({ subIssues: true, issueTypes: ["Epic"], label: "type: epic" });
    expect(m.lane).toEqual({ kind: "labelPrefix", prefix: "product" });
    expect(m.release).toEqual({ kind: "milestone" });
    expect(m.statusField).toBe("Status");
    expect(m.priority).toEqual({ kind: "field", field: "Priority" });
  });

  it("falls back to the iteration field for releases when there are no milestones", () => {
    const p = base();
    p.items.forEach(i => { i.milestone = null; });
    expect(detectMapping(p).release).toEqual({ kind: "iteration", field: "Sprint" });
  });

  it("works on a project with only milestones (no date or iteration fields)", () => {
    const p = base();
    p.fields = p.fields.filter(f => f.kind !== "date" && f.kind !== "iteration");
    p.items.forEach(i => { for (const k of ["Start date", "Target date", "Sprint"]) delete i.fields[k]; });
    const m = detectMapping(p);
    expect(m.startField).toBeNull();
    expect(m.endField).toBeNull();
    expect(m.iterationField).toBeNull();
    expect(m.release).toEqual({ kind: "milestone" });
  });

  it("prefers a 'type: epic' label over per-epic labels like 'epic: payments'", () => {
    const p = base();
    p.items.slice(0, 20).forEach(i => i.labels.push("epic: payments"));
    expect(detectMapping(p).epic.label).toBe("type: epic");
  });
});

describe("item helpers", () => {
  const p = base();
  const m = detectMapping(p);

  it("counts epics by any of the rules", () => {
    expect(p.items.filter(i => isEpic(i, m))).toHaveLength(7);
    expect(isEpic(p.items.find(i => i.kind === "draft")!, m)).toBe(false);
  });

  it("reads lane, release and priority", () => {
    const epic = p.items.find(i => i.issueType === "Epic")!;
    expect(laneOf(epic, m)).toBe("web");
    expect(priorityOf(epic, m)).toEqual({ name: "Critical", rank: 0 });
    const story = p.items.find(i => i.milestone)!;
    expect(releaseOf(story, m)).toMatchObject({ title: expect.stringMatching(/^Release \d$/), due: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it("splits prefixed labels", () => {
    expect(splitPrefixed("product: intelligence")).toEqual(["product", "intelligence"]);
    expect(splitPrefixed("Priority:High")).toEqual(["priority", "High"]);
    expect(splitPrefixed("bug")).toBeNull();
  });
});
