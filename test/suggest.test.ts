// The Epic Map's advice: what it suggests, what it says about each suggestion and
// what happens when you accept one.
import { describe, expect, it } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { normalizeProject, type Project } from "../src/model/normalize";
import { detectMapping, type Mapping } from "../src/model/mapping";
import { applyOps, inverse } from "../src/model/ops";
import { analyze } from "../src/model/epicmap";
import { suggestions, visibleSuggestions, type Suggestion } from "../src/model/epicmap/suggest";
import { communities } from "../src/model/epicmap/cluster";

const f = makeFixture("2026-10-19");
const project = normalizeProject(DEMO_OWNER, f.meta, f.items, "2026-10-19T12:00:00Z");
const mapping = detectMapping(project);
const model = analyze(project, mapping, { openOnly: false });
const deck = suggestions(model, project, mapping);

/** A project with the given items, for the tests that need a shape of their own. */
function shaped(items: { title: string; parent?: string; body?: string; epic?: boolean }[]): { project: Project; mapping: Mapping } {
  const raw = {
    id: "PVT_test", number: 2, title: "Test", url: "https://example.com", shortDescription: null, closed: false, updatedAt: "2026-10-19T00:00:00Z",
    items: { totalCount: items.length },
    fields: { nodes: [{ __typename: "ProjectV2Field", id: "f-title", name: "Title", dataType: "TITLE" }] },
  };
  const numberOf = new Map(items.map((it, n) => [it.title, n + 1]));
  const idOf = new Map(items.map((it, n) => [it.title, `I_${n}`]));
  const raws = items.map((it, n) => ({
    id: `item-${n}`, type: "ISSUE", isArchived: false, fieldValues: { nodes: [] },
    content: {
      __typename: "Issue", id: `I_${n}`, number: n + 1, title: it.title, body: it.body ?? it.title, url: "https://example.com/1",
      state: "OPEN", stateReason: null, createdAt: "2026-10-01T00:00:00Z", closedAt: null, updatedAt: "2026-10-01T00:00:00Z",
      repository: { nameWithOwner: "o/r" },
      labels: { nodes: [{ id: "L_l", name: it.epic ? "type: epic" : "type: story", color: "fff" }] },
      assignees: { nodes: [] }, milestone: null, issueType: null,
      parent: it.parent ? { id: idOf.get(it.parent), number: numberOf.get(it.parent), repository: { nameWithOwner: "o/r" } } : null,
      subIssuesSummary: { total: 0, completed: 0 }, blockedBy: { nodes: [] },
    },
  }));
  const p = normalizeProject("o", raw as never, raws as never, "2026-10-19T00:00:00Z");
  return { project: p, mapping: detectMapping(p) };
}

describe("suggestions", () => {
  it("offers a move for a story that fits another epic better", () => {
    const move = deck.find(s => s.kind === "move");
    expect(move).toBeDefined();
    expect(move!.ops.some(op => op.kind === "setParent")).toBe(true);
    expect(move!.id).toBe(`move:${move!.items[0]}`);
  });

  it("offers to fill a gap with work no epic owns", () => {
    const gap = deck.find(s => s.kind === "gap");
    expect(gap).toBeDefined();
    expect(gap!.ops.some(op => op.kind === "create")).toBe(true);
    expect(gap!.items.length).toBeGreaterThan(0);
  });

  it("sorts the best gain first, and gaps before merges before moves", () => {
    const gains = deck.map(s => s.gain);
    expect([...gains].sort((a, b) => b - a)).toEqual(gains);
    const order = { gap: 0, merge: 1, move: 2, split: 3 };
    for (let i = 1; i < deck.length; i++) {
      if (deck[i - 1]!.gain !== deck[i]!.gain) continue;
      expect(order[deck[i - 1]!.kind]).toBeLessThanOrEqual(order[deck[i]!.kind]);
    }
  });

  it("suggests merging two epics that say the same thing", () => {
    const words = "payment invoice billing receipt charge";
    const { project: p, mapping: m } = shaped([
      { title: "Payments", epic: true, body: words },
      { title: "Invoicing", epic: true, body: words },
      { title: "Invoice PDF", parent: "Payments", body: words },
      { title: "Billing receipt", parent: "Payments", body: words },
      { title: "Payment receipt", parent: "Invoicing", body: words },
      { title: "Invoice receipt", parent: "Invoicing", body: words },
    ]);
    const md = analyze(p, m, { openOnly: false });
    const merge = suggestions(md, p, m).find(s => s.kind === "merge");
    expect(merge).toBeDefined();
    expect(merge!.id).toMatch(/^merge:/);
    // The smaller epic folds into the bigger one and is then removed.
    const archived = merge!.ops.find(op => op.kind === "archive");
    expect(archived).toBeDefined();
    const survivor = merge!.epics[0]!;
    expect(merge!.ops.filter(op => op.kind === "setParent").every(op => op.kind === "setParent" && op.after === survivor)).toBe(true);
  });

  it("undoes an accepted merge cleanly", () => {
    const words = "payment invoice billing receipt charge";
    const { project: p, mapping: m } = shaped([
      { title: "Payments", epic: true, body: words },
      { title: "Invoicing", epic: true, body: words },
      { title: "Invoice PDF", parent: "Payments", body: words },
      { title: "Billing receipt", parent: "Payments", body: words },
      { title: "Payment receipt", parent: "Invoicing", body: words },
      { title: "Invoice receipt", parent: "Invoicing", body: words },
    ]);
    const md = analyze(p, m, { openOnly: false });
    const merge = suggestions(md, p, m).find(s => s.kind === "merge");
    expect(merge).toBeDefined();
    const touched = merge!.items;
    const before = new Map(p.items.filter(i => touched.includes(i.key)).map(i => [i.key, i.parentKey]));
    const undone = applyOps(p, [...merge!.ops, ...merge!.ops.map(inverse).reverse()]).project;
    for (const [key, parent] of before) {
      expect(undone.items.find(i => i.key === key)!.parentKey, key).toBe(parent);
    }
  });

  it("splits an epic that holds two different kinds of work", () => {
    const a = ["alpha invoice", "billing alpha", "payment alpha", "receipt alpha"];
    const b = ["notification push", "mobile push", "badge push", "device push"];
    const { project: p, mapping: m } = shaped([
      { title: "Mixed epic", epic: true, body: "alpha notification" },
      ...a.map((w, n) => ({ title: `Alpha ${n}`, parent: "Mixed epic", body: w })),
      ...b.map((w, n) => ({ title: `Beta ${n}`, parent: "Mixed epic", body: w })),
    ]);
    const md = analyze(p, m, { openOnly: false });
    const split = suggestions(md, p, m).find(s => s.kind === "split");
    expect(split).toBeDefined();
    expect(split!.ops.some(op => op.kind === "create")).toBe(true);
    expect(split!.items.length).toBeGreaterThanOrEqual(3);
  });
});

describe("clustering", () => {
  it("splits a graph with two clusters and keeps one cluster together", () => {
    const edges = [
      { a: 0, b: 1, w: 1 }, { a: 1, b: 2, w: 1 }, { a: 0, b: 2, w: 1 },
      { a: 3, b: 4, w: 1 }, { a: 4, b: 5, w: 1 }, { a: 3, b: 5, w: 1 },
    ];
    const groups = communities([0, 1, 2, 3, 4, 5], edges);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.length).sort()).toEqual([3, 3]);
  });

  it("leaves a single cluster alone", () => {
    const edges = [{ a: 0, b: 1, w: 1 }, { a: 1, b: 2, w: 1 }];
    expect(communities([0, 1, 2], edges)).toHaveLength(1);
  });
});

describe("rejection memory", () => {
  it("hides what was rejected and what is still snoozed", () => {
    const one: Suggestion = deck[0]!;
    const two: Suggestion = deck[1]!;
    const memory = {
      [one.id]: "rejected" as const,
      [two.id]: { snoozedUntil: new Date(Date.now() + 86400000).toISOString() },
    };
    const left = visibleSuggestions(deck, memory);
    expect(left.some(s => s.id === one.id)).toBe(false);
    expect(left.some(s => s.id === two.id)).toBe(false);
  });

  it("brings a snoozed suggestion back once the week is over", () => {
    const one: Suggestion = deck[0]!;
    const memory = { [one.id]: { snoozedUntil: new Date(Date.now() - 1000).toISOString() } };
    expect(visibleSuggestions(deck, memory).some(s => s.id === one.id)).toBe(true);
  });
});
