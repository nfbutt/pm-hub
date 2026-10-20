// The task-to-task similarity graph and how well a grouping (task -> epic) fits it.
// The score is modularity: the share of similarity that stays inside epics, against what a
// random grouping of the same sizes would keep. Pure.
import { cosine, type Vec } from "./text";

export interface Edge { a: number; b: number; w: number }

/** Neighbours kept per task. Enough to see structure, few enough for a thousand tasks. */
const K = 8;
/** Pairs less similar than this aren't related in any useful sense. */
const MIN_SIM = 0.08;
/** Extra weight for a "blocked by" link: dependent work belongs together. */
const LINK_BONUS = 0.3;

/** Top-K neighbour graph over vectors, plus explicit links (pairs of indices). */
export function buildEdges(vecs: Vec[], links: [number, number][]): Edge[] {
  const postings = new Map<string, { i: number; w: number }[]>();
  vecs.forEach((v, i) => { for (const [t, w] of v) { let p = postings.get(t); if (!p) postings.set(t, p = []); p.push({ i, w }); } });
  const weight = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  vecs.forEach((v, i) => {
    const dot = new Map<number, number>();
    for (const [t, w] of v) for (const p of postings.get(t)!) if (p.i !== i) dot.set(p.i, (dot.get(p.i) ?? 0) + w * p.w);
    [...dot.entries()].filter(([, s]) => s >= MIN_SIM).sort((x, y) => y[1] - x[1]).slice(0, K)
      .forEach(([j, s]) => weight.set(key(i, j), s));
  });
  for (const [a, b] of links) {
    if (a === b) continue;
    const k = key(a, b);
    weight.set(k, (weight.get(k) ?? cosine(vecs[a]!, vecs[b]!)) + LINK_BONUS);
  }
  return [...weight.entries()].map(([k, w]) => { const [a, b] = k.split(",").map(Number); return { a: a!, b: b!, w }; });
}

/**
 * Normalised modularity, 0–100: 100 when every bit of similarity sits inside an epic, around 0
 * when epics are no better than random. `group[i]` is task i's epic; tasks with no epic are
 * passed as their own singleton group, so adopting them into the right epic raises the score.
 */
export function structureScore(edges: Edge[], group: string[]): number | null {
  let m = 0;
  const deg = new Map<string, number>(), intra = new Map<string, number>();
  for (const e of edges) {
    m += e.w;
    const ga = group[e.a]!, gb = group[e.b]!;
    deg.set(ga, (deg.get(ga) ?? 0) + e.w);
    deg.set(gb, (deg.get(gb) ?? 0) + e.w);
    if (ga === gb) intra.set(ga, (intra.get(ga) ?? 0) + e.w);
  }
  if (m === 0) return null;
  let inside = 0, expected = 0;
  for (const v of intra.values()) inside += v / m;
  for (const d of deg.values()) expected += (d / (2 * m)) ** 2;
  if (expected >= 1) return null;
  const q = (inside - expected) / (1 - expected);
  return Math.round(Math.max(0, Math.min(1, q)) * 100);
}
