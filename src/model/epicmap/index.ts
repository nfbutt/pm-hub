// The Epic Map's model: which tasks sit in which epic, how well each one fits, where epics
// overlap, what kind of work each epic is, and which kinds of work have no epic. Pure.
import { isEpic, priorityOf, releaseOf, type Mapping } from "../mapping";
import type { Item, Project } from "../normalize";
import { CATEGORIES, categorize, dominant, mergeMixes, UNCATEGORIZED, type Mix } from "./categories";
import { buildEdges, structureScore, type Edge } from "./graph";
import { centroid, cosine, sharedTerms, terms, tfidf, type Vec } from "./text";

export interface MapTask {
  key: string; title: string; state: Item["state"]; assignees: string[];
  epicKey: string | null;
  mix: Mix; category: string;
  /** Similarity to its own epic (without itself) and to the closest other epic. */
  ownSim: number; best: { epicKey: string; sim: number } | null;
  /** True when another epic matches clearly better than its own (or it has no epic and one matches). */
  misfit: boolean;
}

export interface MapEpic {
  key: string; title: string; state: Item["state"];
  taskKeys: string[]; done: number;
  mix: Mix; category: string; purity: number;
  /** 0–1: how alike its tasks are. */
  cohesion: number;
  /** 0–1: share of its tasks' similarity that points into other epics. */
  coupling: number;
  /** 0–100, or null for an epic with no tasks to judge. */
  health: number | null;
  flags: string[];
  priority: string | null; release: string | null;
}

export interface Overlap { a: string; b: string; score: number; shared: string[] }
export interface Move { taskKey: string; from: string | null; to: string; gain: number; sim: number }
export interface Gap { category: string; weight: number; taskKeys: string[] }

export interface EpicMapModel {
  tasks: MapTask[]; epics: MapEpic[]; overlaps: Overlap[];
  edges: Edge[];
  /** 0–100 structure score; null when nothing is similar to anything yet. */
  score: number | null;
  moves: Move[]; gaps: Gap[];
  categories: { id: string; tasks: number; epics: number }[];
}

export interface MapOptions { openOnly: boolean }

/** Nearest epic above an item, skipping plain parents (sub-sub-issues roll up to their epic). */
function epicAbove(i: Item, byKey: Map<string, Item>, epics: Set<string>): string | null {
  const seen = new Set<string>();
  for (let k = i.parentKey; k && !seen.has(k); k = byKey.get(k)?.parentKey ?? null) {
    if (epics.has(k)) return k;
    seen.add(k);
  }
  return null;
}

export function analyze(p: Project, m: Mapping, opts: MapOptions): EpicMapModel {
  const byKey = new Map(p.items.map(i => [i.key, i]));
  const live = (i: Item) => !opts.openOnly || i.state === "open";
  const epicItems = p.items.filter(i => isEpic(i, m) && live(i));
  const epicSet = new Set(epicItems.map(e => e.key));
  // Pull requests have no parent on GitHub, so they would only crowd the "no epic" tray.
  const taskItems = p.items.filter(i => !isEpic(i, m) && live(i) && (i.kind === "issue" || i.kind === "draft"));

  const surface = new Map<string, string>();
  const docs = [...taskItems, ...epicItems].map(i => terms(i.title, i.body, i.labels, surface));
  const vecs = tfidf(docs);
  const tvec = vecs.slice(0, taskItems.length), evec = vecs.slice(taskItems.length);
  const taskIndex = new Map(taskItems.map((t, i) => [t.key, i]));
  const epicOf = taskItems.map(t => epicAbove(t, byKey, epicSet));

  const links: [number, number][] = [];
  taskItems.forEach((t, i) => { for (const b of t.blockedBy) { const j = taskIndex.get(b.key); if (j !== undefined) links.push([i, j]); } });
  const edges = buildEdges(tvec, links);
  const group = (epics: (string | null)[]) => epics.map((e, i) => e ?? `none:${i}`);
  const score = structureScore(edges, group(epicOf));

  // Each epic as the sum of its own description (counted twice) and its tasks.
  const sums = new Map<string, Vec>();
  epicItems.forEach((e, i) => sums.set(e.key, scale(evec[i]!, 2)));
  taskItems.forEach((_, i) => { const e = epicOf[i]; if (e) addInto(sums.get(e)!, tvec[i]!); });
  const norms = new Map([...sums].map(([k, v]) => [k, Math.sqrt(dot(v, v))]));

  const mixes = taskItems.map(t => categorize(t.title, t.body, t.labels));
  const tasks: MapTask[] = taskItems.map((t, i) => {
    const v = tvec[i]!, own = epicOf[i]!;
    let ownSim = 0;
    if (own) {
      // Cosine to the epic without this task in it: |S - v|² = |S|² - 2·v·S + |v|².
      const s = sums.get(own)!, vs = dot(v, s), vv = dot(v, v), n2 = norms.get(own)! ** 2 - 2 * vs + vv;
      ownSim = n2 > 1e-9 ? (vs - vv) / Math.sqrt(n2) : 0;
    }
    let best: MapTask["best"] = null;
    for (const [k, s] of sums) {
      if (k === own) continue;
      const n = norms.get(k)!;
      const sim = n > 0 ? dot(v, s) / n : 0;
      if (!best || sim > best.sim) best = { epicKey: k, sim };
    }
    const misfit = !!best && best.sim >= 0.15 && best.sim > ownSim + 0.05;
    return {
      key: t.key, title: t.title, state: t.state, assignees: t.assignees, epicKey: own,
      mix: mixes[i]!, category: dominant(mixes[i]!).id, ownSim, best, misfit,
    };
  });

  // How much of each task's similarity stays home.
  const strength = new Map<string, number>(), crossing = new Map<string, number>(), between = new Map<string, number>();
  for (const e of edges) {
    const ga = epicOf[e.a], gb = epicOf[e.b];
    for (const g of [ga, gb]) if (g) strength.set(g, (strength.get(g) ?? 0) + e.w);
    if (ga !== gb) {
      for (const g of [ga, gb]) if (g) crossing.set(g, (crossing.get(g) ?? 0) + e.w);
      if (ga && gb) { const k = pairKey(ga, gb); between.set(k, (between.get(k) ?? 0) + e.w); }
    }
  }

  const sizes = epicItems.map(e => tasks.filter(t => t.epicKey === e.key).length).filter(n => n > 0).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
  const epics: MapEpic[] = epicItems.map(e => {
    const mine = tasks.filter(t => t.epicKey === e.key);
    const mix = mergeMixes([...mine.map(t => t.mix), categorize(e.title, e.body, e.labels)]);
    const top = dominant(mix);
    const cohesion = mine.length > 1 ? mine.reduce((s, t) => s + Math.max(0, t.ownSim), 0) / mine.length : mine.length === 1 ? Math.max(0, mine[0]!.ownSim) : 0;
    const st = strength.get(e.key) ?? 0;
    const coupling = st > 0 ? (crossing.get(e.key) ?? 0) / st : 0;
    const flags: string[] = [];
    if (mine.length === 0) flags.push("No tasks yet");
    if (mine.length === 1) flags.push("Only one task");
    if (median >= 3 && mine.length > median * 2.5) flags.push("Much bigger than the rest: worth splitting?");
    if (top.share > 0 && top.share < 0.4) flags.push("Mixes many kinds of work");
    const misfits = mine.filter(t => t.misfit).length;
    if (misfits) flags.push(`${misfits} task${misfits > 1 ? "s" : ""} may belong elsewhere`);
    const health = mine.length === 0 ? null
      : Math.round(100 * (0.4 * Math.min(1, cohesion / 0.45) + 0.35 * (1 - coupling) + 0.25 * top.share));
    return {
      key: e.key, title: e.title, state: e.state, taskKeys: mine.map(t => t.key),
      done: mine.length ? mine.filter(t => t.state !== "open").length / mine.length : (e.state === "open" ? 0 : 1),
      mix, category: top.id, purity: top.share, cohesion, coupling, health, flags,
      priority: priorityOf(e, m)?.name ?? null, release: releaseOf(e, m)?.title ?? null,
    };
  });

  const cents = new Map(epicItems.map(e => [e.key, centroid([{ v: sums.get(e.key)!, w: 1 }])]));
  const overlaps: Overlap[] = [];
  for (let i = 0; i < epicItems.length; i++) for (let j = i + 1; j < epicItems.length; j++) {
    const a = epicItems[i]!.key, b = epicItems[j]!.key;
    const ca = cents.get(a)!, cb = cents.get(b)!;
    const sa = strength.get(a) ?? 0, sb = strength.get(b) ?? 0;
    const cross = Math.min(sa, sb) > 0 ? (between.get(pairKey(a, b)) ?? 0) / Math.min(sa, sb) : 0;
    const s = 0.6 * cosine(ca, cb) + 0.4 * Math.min(1, cross);
    if (s >= 0.12) overlaps.push({ a, b, score: s, shared: sharedTerms(ca, cb, 4, surface) });
  }
  overlaps.sort((x, y) => y.score - x.score);

  const moves: Move[] = tasks.filter(t => t.misfit && t.best).map(t => ({
    taskKey: t.key, from: t.epicKey, to: t.best!.epicKey, sim: t.best!.sim,
    gain: (scoreIfMovedRaw(edges, epicOf, taskIndex.get(t.key)!, t.best!.epicKey) ?? 0) - (score ?? 0),
  })).sort((a, b) => b.gain - a.gain || b.sim - a.sim);

  const categories = [...CATEGORIES.map(c => c.id), UNCATEGORIZED].map(id => ({
    id, tasks: tasks.filter(t => t.category === id).length, epics: epics.filter(e => e.category === id).length,
  })).filter(c => c.tasks || c.epics);

  // A kind of work with real weight across tasks that no epic is mostly about.
  const gaps: Gap[] = CATEGORIES.map(c => {
    const weight = tasks.reduce((s, t) => s + (t.mix.get(c.id) ?? 0), 0);
    const homed = epics.some(e => (e.mix.get(c.id) ?? 0) >= 0.3);
    const keys = tasks.filter(t => (t.mix.get(c.id) ?? 0) >= 0.4).sort((a, b) => (b.mix.get(c.id) ?? 0) - (a.mix.get(c.id) ?? 0)).map(t => t.key);
    return { category: c.id, weight, taskKeys: keys, homed };
  }).filter(g => !g.homed && g.taskKeys.length >= 2 && g.weight >= 1.5)
    .map(({ category, weight, taskKeys }) => ({ category, weight, taskKeys }))
    .sort((a, b) => b.weight - a.weight);

  return { tasks, epics, overlaps, edges, score, moves, gaps, categories };
}

/** The structure score if one task moved to another epic (null = out of every epic). */
export function scoreIfMoved(model: EpicMapModel, taskKey: string, epicKey: string | null): number | null {
  const idx = model.tasks.findIndex(t => t.key === taskKey);
  if (idx < 0) return model.score;
  return scoreIfMovedRaw(model.edges, model.tasks.map(t => t.epicKey), idx, epicKey);
}

function scoreIfMovedRaw(edges: Edge[], epicOf: (string | null)[], idx: number, epicKey: string | null): number | null {
  const next = epicOf.map((e, i) => (i === idx ? epicKey : e) ?? `none:${i}`);
  return structureScore(edges, next);
}

// Works on unnormalised sums too: it is a plain dot product.
const dot = cosine;
const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
const scale = (v: Vec, k: number): Vec => new Map([...v].map(([t, w]) => [t, w * k]));
function addInto(into: Vec, v: Vec) { for (const [t, w] of v) into.set(t, (into.get(t) ?? 0) + w); }
