import { describe, expect, it } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { normalizeProject } from "../src/model/normalize";
import { detectMapping } from "../src/model/mapping";
import { applyOps } from "../src/model/ops";
import { moveToParent } from "../src/model/edits";
import { analyze, scoreIfMoved } from "../src/model/epicmap";
import { categorize, dominant } from "../src/model/epicmap/categories";
import { cosine, terms, tfidf, tokenize } from "../src/model/epicmap/text";
import { structureScore } from "../src/model/epicmap/graph";

const f = makeFixture("2026-10-19");
const project = normalizeProject(DEMO_OWNER, f.meta, f.items, "2026-10-19T12:00:00Z");
const mapping = detectMapping(project);
const byTitle = (t: string) => project.items.find(i => i.title === t)!;

describe("text", () => {
  it("stems plurals and drops stop words", () => {
    expect(tokenize("The notifications and Notification")).toEqual(["notification", "notification"]);
  });
  it("finds related documents more similar than unrelated ones", () => {
    const [a, b, c, d] = tfidf([
      terms("Push notification delivery", "APNs device tokens", []),
      terms("Notification preferences", "push notification settings", []),
      terms("Invoice PDF layout", "billing invoice", []),
      terms("Invoice totals", "tax on the invoice", []),
    ]);
    expect(cosine(a!, b!)).toBeGreaterThan(cosine(a!, c!));
    expect(cosine(c!, d!)).toBeGreaterThan(cosine(b!, d!));
  });
});

describe("categories", () => {
  it("reads kinds of work from words and labels", () => {
    expect(dominant(categorize("SSO login", "SAML session security", [])).id).toBe("security");
    expect(dominant(categorize("Something", undefined, ["area: frontend"])).id).toBe("frontend");
    expect(categorize("zzz", undefined, []).size).toBe(0);
  });
});

describe("structure score", () => {
  it("is high when similar things share a group and low when they're split", () => {
    const edges = [{ a: 0, b: 1, w: 1 }, { a: 2, b: 3, w: 1 }, { a: 1, b: 2, w: 0.1 }];
    expect(structureScore(edges, ["x", "x", "y", "y"])!).toBeGreaterThan(structureScore(edges, ["x", "y", "x", "y"])!);
    expect(structureScore([], ["x"])).toBeNull();
  });
});

describe("analyze the demo project", () => {
  const model = analyze(project, mapping, { openOnly: false });

  it("puts every story under its epic and scores the result", () => {
    expect(model.epics).toHaveLength(7);
    expect(model.tasks.filter(t => t.epicKey).length).toBeGreaterThan(30);
    expect(model.score).toBeGreaterThan(0);
  });

  it("flags a story written into the wrong epic, and moving it raises the score", () => {
    const stray = model.moves.find(mv => mv.from === byTitle("Mobile notifications").key && mv.to === byTitle("Offline mode").key);
    expect(stray).toBeDefined();
    expect(scoreIfMoved(model, stray!.taskKey, stray!.to)!).toBeGreaterThan(model.score!);
    // Recording the move and analysing again agrees with the preview.
    const item = project.items.find(i => i.key === stray!.taskKey)!;
    const after = analyze(applyOps(project, moveToParent(project, item, stray!.to)).project, mapping, { openOnly: false });
    expect(after.score).toBe(scoreIfMoved(model, stray!.taskKey, stray!.to));
  });

  it("finds overlapping epics and explains them", () => {
    const pair = model.overlaps.find(o => [o.a, o.b].sort().join() === [byTitle("Mobile notifications").key, byTitle("Offline mode").key].sort().join());
    expect(pair).toBeDefined();
    expect(pair!.shared.length).toBeGreaterThan(0);
  });

  it("finds security work no epic owns", () => {
    const gap = model.gaps.find(g => g.category === "security");
    expect(gap).toBeDefined();
    expect(gap!.taskKeys).toContain(byTitle("Explore SSO for enterprise tier").key);
  });

  it("hides closed work when asked", () => {
    const open = analyze(project, mapping, { openOnly: true });
    expect(open.tasks.every(t => t.state === "open")).toBe(true);
    expect(open.epics.some(e => e.title === "Customer onboarding flow")).toBe(false);
  });
});
