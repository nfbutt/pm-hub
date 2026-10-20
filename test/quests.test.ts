// The last pieces of the Epic Map: the goals a team works through, the plan history read
// back as a map, and the lenses the map can be coloured by.
import { describe, expect, it } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { normalizeProject } from "../src/model/normalize";
import { detectMapping } from "../src/model/mapping";
import { analyze } from "../src/model/epicmap";
import { baselineMapping, baselineProject } from "../src/model/epicmap/baseline";
import { lensColours, lensValue, LENSES } from "../src/model/epicmap/lens";
import { quests } from "../src/model/epicmap/quests";
import { snapshot } from "../src/model/diff";
import { buildSchedule } from "../src/model/schedule";
import { applyOps } from "../src/model/ops";
import { moveToParent } from "../src/model/edits";

const f = makeFixture("2026-10-19");
const project = normalizeProject(DEMO_OWNER, f.meta, f.items, "2026-10-19T12:00:00Z");
const mapping = detectMapping(project);
const model = analyze(project, mapping, { openOnly: false });

describe("quests", () => {
  it("counts what the team has done against the goals", () => {
    const list = quests(model, model);
    expect(list.map(q => q.id)).toEqual(["overlaps", "orphans", "gap", "score"]);
    expect(list.every(q => q.goal > 0)).toBe(true);
    expect(list.every(q => q.progress === 0)).toBe(true);
  });

  it("gives credit when the plan gets better", () => {
    // Move a task that the map says belongs elsewhere: the score goes up.
    const mv = model.moves[0]!;
    const item = project.items.find(i => i.key === mv.taskKey)!;
    const after = analyze(applyOps(project, moveToParent(project, item, mv.to)).project, mapping, { openOnly: false });
    const list = quests(model, after);
    const score = list.find(q => q.id === "score")!;
    expect(score.progress).toBeGreaterThan(0);
    expect(after.score!).toBeGreaterThan(model.score!);
  });

  it("is finished when the goal is reached", () => {
    const list = quests(model, model);
    expect(list.find(q => q.id === "score")!.done).toBe(false);
    const high = { ...model, score: (model.score ?? 0) + 10 };
    expect(quests(model, high).find(q => q.id === "score")!.done).toBe(true);
  });
});

describe("reading a baseline as a map", () => {
  it("puts every item back where it was", () => {
    const schedule = buildSchedule(project, mapping);
    const baseline = snapshot(project, mapping, schedule, "Q1 plan", false, "2026-01-01T00:00:00.000Z");
    const rebuilt = baselineProject(project, baseline);
    expect(rebuilt.items.length).toBe(baseline.items.length);
    for (const b of baseline.items) {
      const item = rebuilt.items.find(i => i.key === b.key)!;
      expect(item.parentKey).toBe(b.parentKey);
      expect(item.issueType === "Epic").toBe(b.epic);
      expect(item.title).toBe(b.title);
    }
  });

  it("runs the analysis on it", () => {
    const schedule = buildSchedule(project, mapping);
    const baseline = snapshot(project, mapping, schedule, "Q1 plan", false, "2026-01-01T00:00:00.000Z");
    const past = analyze(baselineProject(project, baseline), baselineMapping(mapping), { openOnly: false });
    expect(past.epics.length).toBe(model.epics.length);
    expect(past.score).not.toBeNull();
  });
});

describe("lenses", () => {
  it("has a value for every item", () => {
    const node = { category: "backend", release: "Release 1", priority: "High", assignees: ["ana"] };
    expect(lensValue("category", node)).toBe("backend");
    expect(lensValue("release", node)).toBe("Release 1");
    expect(lensValue("priority", node)).toBe("High");
    expect(lensValue("assignee", node)).toBe("ana");
    expect(LENSES.map(l => l.id)).toEqual(["category", "release", "assignee", "priority"]);
  });

  it("says when an item belongs to nothing", () => {
    const node = { category: "backend", release: null, priority: null, assignees: [] };
    expect(lensValue("release", node)).toBe("No release");
    expect(lensValue("assignee", node)).toBe("Nobody");
    expect(lensValue("priority", node)).toBe("No priority");
  });

  it("gives every group a colour of its own", () => {
    const colours = lensColours(["b", "a", "c", "a"]);
    expect(colours.size).toBe(3);
    expect(new Set(colours.values()).size).toBe(3);
    // The same groups always get the same colours.
    expect(lensColours(["a", "b"]).get("a")).toBe(lensColours(["b", "a"]).get("a"));
  });

  it("groups the real epics by every lens", () => {
    for (const lens of LENSES.map(l => l.id)) {
      const values = [...model.epics.map(e => lensValue(lens, e)), ...model.tasks.map(t => lensValue(lens, t))];
      expect(values.length).toBe(model.epics.length + model.tasks.length);
      expect(values.every(v => typeof v === "string" && v.length > 0)).toBe(true);
    }
  });
});
