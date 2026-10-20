// Comparing two epics: what each covers, what they share, and the changes you can make
// by moving a story from one to the other.
import { describe, expect, it } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { normalizeProject } from "../src/model/normalize";
import { detectMapping } from "../src/model/mapping";
import { compareEpics, proposeMove, storiesOf } from "../src/model/plan/compare";
import { checkCompare } from "../src/ai/compare";
import { evidenceFound } from "../src/model/plan/infer";
import { applyOps } from "../src/model/ops";

const f = makeFixture("2026-10-19");
const project = normalizeProject(DEMO_OWNER, f.meta, f.items, "2026-10-19T12:00:00Z");
const mapping = detectMapping(project);
const epic = (title: string) => project.items.find(i => i.title === title)!;

describe("comparing two epics", () => {
  const a = epic("Mobile notifications");
  const b = epic("Offline mode");
  const comparison = compareEpics(project, mapping, a, b, 0.42);

  it("lists the stories of each side", () => {
    expect(comparison.a.stories.length).toBeGreaterThan(0);
    expect(comparison.b.stories.length).toBeGreaterThan(0);
    expect(comparison.a.stories.every(s => s.title !== b.title)).toBe(true);
  });

  it("says how alike they are and what they share", () => {
    expect(comparison.overlap).toBe(0.42);
    expect(Array.isArray(comparison.shared)).toBe(true);
  });

  it("knows which stories are only on one side", () => {
    const keysA = new Set(comparison.a.stories.map(s => s.key));
    const keysB = new Set(comparison.b.stories.map(s => s.key));
    expect(comparison.onlyInA.every(s => !keysB.has(s.key))).toBe(true);
    expect(comparison.onlyInB.every(s => !keysA.has(s.key))).toBe(true);
    expect(comparison.inBoth.every(s => keysA.has(s.key) && keysB.has(s.key))).toBe(true);
  });

  it("finds the stories of an epic, even the ones further down", () => {
    const stories = storiesOf(project, a);
    expect(stories.length).toBeGreaterThan(0);
    expect(stories.every(s => s.state === "open")).toBe(true);
  });
});

describe("moving a story from one epic to the other", () => {
  it("is the change that moves it", () => {
    const a = epic("Mobile notifications");
    const b = epic("Offline mode");
    const story = storiesOf(project, a)[0]!;
    const move = proposeMove(project, story, a, b);
    expect(move).not.toBeNull();
    expect(move!.ops[0]).toMatchObject({ kind: "setParent", key: story.key, after: b.key });
  });

  it("puts the story under the other epic when it is applied", () => {
    const a = epic("Mobile notifications");
    const b = epic("Offline mode");
    const story = storiesOf(project, a)[0]!;
    const move = proposeMove(project, story, a, b)!;
    const applied = applyOps(project, move.ops);
    expect(applied.project.items.find(i => i.key === story.key)!.parentKey).toBe(b.key);
  });

  it("will not move a story into the epic it is already in", () => {
    const a = epic("Mobile notifications");
    const story = storiesOf(project, a)[0]!;
    expect(proposeMove(project, story, a, a)).toBeNull();
  });
});

describe("what a model says about two epics", () => {
  it("has to have the right shape", () => {
    const good = { cover: { a: "one", b: "two" }, common: [{ text: "x", evidence: "y" }], different: [] };
    expect(checkCompare(good)).toBe(true);
    expect(checkCompare({ cover: { a: "one" }, common: [], different: [] })).toBe(false);
    expect(checkCompare({ cover: { a: "one", b: "two" }, common: [{ text: "x" }], different: [] })).toBe(false);
    expect(checkCompare(null)).toBe(false);
  });

  it("a claim can only be kept if its words are really in the epics", () => {
    const story = storiesOf(project, epic("Mobile notifications"))[0]!;
    expect(evidenceFound(story.title, story)).toBe(true);
    expect(evidenceFound("something nobody wrote", story)).toBe(false);
  });
});
