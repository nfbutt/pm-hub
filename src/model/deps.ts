// Dependency graph: "blocked by" edges (and optionally parent/child), cycles and the
// critical path through open work. Pure; layout happens in the view.
import { isEpic, type Mapping } from "./mapping";
import type { Item, Project } from "./normalize";
import { daysBetween, type Schedule } from "./schedule";

export interface Edge { from: string; to: string; kind: "blocks" | "parent" }
export interface Graph { nodes: Item[]; edges: Edge[] }

export interface GraphOptions { parentEdges: boolean; openOnly: boolean; epicsOnly: boolean }

/** Nodes are items that touch at least one edge. A "blocks" edge runs blocker -> blocked. */
export function buildGraph(p: Project, m: Mapping, opts: GraphOptions): Graph {
  const byKey = new Map(p.items.map(i => [i.key, i]));
  const keep = (i: Item | undefined): i is Item => !!i && (!opts.openOnly || i.state === "open") && (!opts.epicsOnly || isEpic(i, m));
  const edges: Edge[] = [];
  for (const i of p.items) {
    if (!keep(i)) continue;
    for (const b of i.blockedBy) { const from = byKey.get(b.key); if (keep(from)) edges.push({ from: from.key, to: i.key, kind: "blocks" }); }
    if (opts.parentEdges && i.parentKey) { const parent = byKey.get(i.parentKey); if (keep(parent)) edges.push({ from: parent.key, to: i.key, kind: "parent" }); }
  }
  const used = new Set(edges.flatMap(e => [e.from, e.to]));
  return { nodes: p.items.filter(i => used.has(i.key)), edges };
}

/** Strongly connected components with more than one node (or a self-loop), over "blocks" edges. */
export function findCycles(g: Graph): string[][] {
  const adj = new Map<string, string[]>();
  for (const n of g.nodes) adj.set(n.key, []);
  for (const e of g.edges) if (e.kind === "blocks") adj.get(e.from)?.push(e.to);
  let index = 0;
  const idx = new Map<string, number>(), low = new Map<string, number>(), onStack = new Set<string>(), stack: string[] = [];
  const out: string[][] = [];
  const strong = (v: string) => {
    idx.set(v, index); low.set(v, index); index++; stack.push(v); onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1 || (adj.get(v) ?? []).includes(v)) out.push(comp.reverse());
    }
  };
  for (const n of g.nodes) if (!idx.has(n.key)) strong(n.key);
  return out;
}

/** Remaining duration in days: the rest of the bar from today, or 1 day for undated open items, 0 for closed. */
export function remainingDays(i: Item, s: Schedule, today: string): number {
  if (i.state !== "open") return 0;
  const b = s.bars.get(i.key);
  if (!b) return 1;
  const from = b.start > today ? b.start : today;
  return Math.max(1, daysBetween(from, b.end) + 1);
}

/** Longest chain of open work over "blocks" edges, ignoring anything inside a cycle. */
export function criticalPath(g: Graph, s: Schedule, today: string): { path: string[]; days: number } {
  const inCycle = new Set(findCycles(g).flat());
  const nodes = g.nodes.filter(n => n.state === "open" && !inCycle.has(n.key));
  const keys = new Set(nodes.map(n => n.key));
  const preds = new Map<string, string[]>(nodes.map(n => [n.key, []]));
  for (const e of g.edges) if (e.kind === "blocks" && keys.has(e.from) && keys.has(e.to)) preds.get(e.to)!.push(e.from);
  const cost = new Map(nodes.map(n => [n.key, remainingDays(n, s, today)]));
  const best = new Map<string, { days: number; prev: string | null }>();
  const visit = (k: string): number => {
    const known = best.get(k); if (known) return known.days;
    let top = 0, prev: string | null = null;
    for (const p of preds.get(k) ?? []) { const d = visit(p); if (d > top) { top = d; prev = p; } }
    const days = top + (cost.get(k) ?? 0);
    best.set(k, { days, prev });
    return days;
  };
  let end: string | null = null, max = 0;
  for (const n of nodes) { const d = visit(n.key); if (d > max) { max = d; end = n.key; } }
  const path: string[] = [];
  for (let k = end; k; k = best.get(k)?.prev ?? null) path.unshift(k);
  // A single node with no dependencies isn't a "path".
  return path.length > 1 ? { path, days: max } : { path: [], days: 0 };
}
