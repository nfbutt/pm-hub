import { describe, expect, it } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { buildGraph, criticalPath, findCycles, remainingDays, type Graph } from "../src/model/deps";
import { detectMapping } from "../src/model/mapping";
import { normalizeProject, type Item } from "../src/model/normalize";
import { buildSchedule } from "../src/model/schedule";

const TODAY = "2026-10-19";
const load = () => { const f = makeFixture(TODAY); return normalizeProject(DEMO_OWNER, f.meta, f.items, TODAY + "T12:00:00Z"); };
const p = load();
const m = detectMapping(p);
const s = buildSchedule(p, m);

const item = (key: string, extra: Partial<Item> = {}): Item => ({
  id: key, key, kind: "issue", number: 1, repo: "o/r", title: key, url: null, state: "open", stateReason: null,
  createdAt: null, closedAt: null, updatedAt: null, labels: [], assignees: [], milestone: null, issueType: null,
  parentKey: null, subIssues: null, blockedBy: [], archived: false, fields: {}, ...extra,
});

describe("buildGraph", () => {
  it("draws blocker -> blocked edges between items that exist", () => {
    const g = buildGraph(p, m, { parentEdges: false, openOnly: false, epicsOnly: false });
    expect(g.edges.length).toBeGreaterThan(0);
    const keys = new Set(g.nodes.map(n => n.key));
    for (const e of g.edges) { expect(e.kind).toBe("blocks"); expect(keys.has(e.from) && keys.has(e.to)).toBe(true); }
  });

  it("adds parent edges on request and can limit to epics", () => {
    const withParents = buildGraph(p, m, { parentEdges: true, openOnly: false, epicsOnly: false });
    expect(withParents.edges.some(e => e.kind === "parent")).toBe(true);
    const epics = buildGraph(p, m, { parentEdges: false, openOnly: true, epicsOnly: true });
    expect(epics.nodes.map(n => n.title).sort()).toEqual(["Audit log and exports", "Public REST API v2", "Usage-based pricing engine"]);
  });

  it("drops closed blockers when only open work is shown", () => {
    const all = buildGraph(p, m, { parentEdges: false, openOnly: false, epicsOnly: false });
    const open = buildGraph(p, m, { parentEdges: false, openOnly: true, epicsOnly: false });
    expect(open.edges.length).toBeLessThan(all.edges.length);
    expect(open.nodes.every(n => n.state === "open")).toBe(true);
  });
});

describe("cycles", () => {
  it("finds none in the fixture and finds a planted one", () => {
    expect(findCycles(buildGraph(p, m, { parentEdges: false, openOnly: false, epicsOnly: false }))).toEqual([]);
    const a = item("a"), b = item("b"), c = item("c");
    const g: Graph = { nodes: [a, b, c], edges: [{ from: "a", to: "b", kind: "blocks" }, { from: "b", to: "c", kind: "blocks" }, { from: "c", to: "a", kind: "blocks" }] };
    expect(findCycles(g).map(x => [...x].sort())).toEqual([["a", "b", "c"]]);
  });

  it("ignores parent edges when looking for cycles", () => {
    const a = item("a"), b = item("b");
    const g: Graph = { nodes: [a, b], edges: [{ from: "a", to: "b", kind: "parent" }, { from: "b", to: "a", kind: "blocks" }] };
    expect(findCycles(g)).toEqual([]);
  });
});

describe("criticalPath", () => {
  it("follows the epic chain pricing -> API v2 -> audit log in the fixture", () => {
    const g = buildGraph(p, m, { parentEdges: false, openOnly: true, epicsOnly: true });
    const cp = criticalPath(g, s, TODAY);
    expect(cp.path.map(k => s.byKey.get(k)!.title)).toEqual(["Usage-based pricing engine", "Public REST API v2", "Audit log and exports"]);
    expect(cp.days).toBe(cp.path.reduce((n, k) => n + remainingDays(s.byKey.get(k)!, s, TODAY), 0));
  });

  it("picks the longer of two branches and skips cycles", () => {
    const nodes = ["a", "b", "c", "d", "x", "y"].map(k => item(k));
    const g: Graph = { nodes, edges: [
      { from: "a", to: "b", kind: "blocks" }, { from: "b", to: "c", kind: "blocks" }, { from: "a", to: "d", kind: "blocks" },
      { from: "x", to: "y", kind: "blocks" }, { from: "y", to: "x", kind: "blocks" },
    ] };
    const empty = buildSchedule({ ...p, items: nodes }, m);
    expect(criticalPath(g, empty, TODAY).path).toEqual(["a", "b", "c"]);
  });

  it("returns nothing when there is no chain", () => {
    const g: Graph = { nodes: [item("solo")], edges: [] };
    expect(criticalPath(g, s, TODAY)).toEqual({ path: [], days: 0 });
  });
});
