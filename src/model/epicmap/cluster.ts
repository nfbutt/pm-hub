// Finding groups of similar tasks inside one epic. A greedy pass over modularity gains:
// every task starts on its own, then the two groups whose merge helps the modularity most
// are joined, until no merge helps. Small, exact and deterministic, which is all a map of
// a few hundred tasks needs. Pure.
import type { Edge } from "./graph";

/**
 * Splits a set of task indices into groups of similar tasks.
 * `nodes` are indices into the task list; `edges` connect them. Returns groups of indices.
 */
export function communities(nodes: number[], edges: Edge[]): number[][] {
  const n = nodes.length;
  if (n <= 1) return nodes.map(x => [x]);
  const pos = new Map(nodes.map((x, i) => [x, i]));
  const deg = new Array<number>(n).fill(0);
  const pair = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const weights = new Map<string, number>();
  for (const e of edges) {
    const a = pos.get(e.a), b = pos.get(e.b);
    if (a === undefined || b === undefined || a === b) continue;
    deg[a]! += e.w; deg[b]! += e.w;
    const k = pair(a, b);
    weights.set(k, (weights.get(k) ?? 0) + e.w);
  }
  const total = deg.reduce((s, d) => s + d, 0) / 2;
  if (total <= 0) return nodes.map(x => [x]);

  const groups = nodes.map((_, i) => ({ members: [i], deg: deg[i]!, alive: true }));
  const between: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const [k, w] of weights) {
    const [a, b] = k.split(",").map(Number);
    if (a === undefined || b === undefined) continue;
    between[a]![b]! += w; between[b]![a]! += w;
  }
  for (;;) {
    let bi = -1, bj = -1, best = 0;
    for (let i = 0; i < n; i++) {
      if (!groups[i]!.alive) continue;
      for (let j = i + 1; j < n; j++) {
        if (!groups[j]!.alive) continue;
        // Merging i and j changes the modularity by (edge weight between them) / m
        // minus their share of all the weights. Only positive gains are worth taking.
        const gain = 2 * total * between[i]![j]! - groups[i]!.deg * groups[j]!.deg;
        if (gain > best) { best = gain; bi = i; bj = j; }
      }
    }
    if (bi < 0) break;
    groups[bi]!.members.push(...groups[bj]!.members);
    groups[bi]!.deg += groups[bj]!.deg;
    for (let k = 0; k < n; k++) {
      if (k === bi || k === bj || !groups[k]!.alive) continue;
      between[bi]![k]! += between[bj]![k]!;
      between[k]![bi]! += between[bj]![k]!;
    }
    groups[bj]!.alive = false;
  }
  return groups.filter(g => g.alive).map(g => g.members.map(i => nodes[i]!));
}
