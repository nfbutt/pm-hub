// The Epic Map's advice: a deck of things worth doing to the plan. Every suggestion is a
// list of ops, so accepting one is just another recorded change. Pure: nothing here writes.
import { moveToParent, newItem, splitItem } from "../edits";
import type { Mapping } from "../mapping";
import type { Item, Project } from "../normalize";
import { applyOps, type Op } from "../ops";
import { categoryName } from "./categories";
import { communities } from "./cluster";
import { analyze, type EpicMapModel } from "./index";
import { hashText } from "./text";

export type SuggestionKind = "move" | "merge" | "split" | "gap";

export interface Suggestion {
  /** Stable, so a suggestion you turned down stays turned down. */
  id: string;
  kind: SuggestionKind;
  title: string;
  why: string;
  /** What the structure score would become, minus what it is now. */
  gain: number;
  /** The changes to record when the suggestion is accepted. */
  ops: Op[];
  /** The epics involved, so the map can show them. */
  epics: string[];
  /** The items involved. */
  items: string[];
  /** True when a model on this computer wrote the words. */
  byModel?: boolean;
}

/** What you said about a suggestion: no, or not for a while. */
export type SuggestionVerdict = "rejected" | { snoozedUntil: string };
export type SuggestionMemory = Record<string, SuggestionVerdict>;

/** Two epics this alike are probably the same epic twice. */
const MERGE_SCORE = 0.35;
/** An epic this big probably holds two different pieces of work. */
const SPLIT_TASKS = 6;
/** A group of fewer tasks than this isn't worth an epic of its own. */
const SPLIT_GROUP = 3;

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * The ops that give a kind of work an epic of its own and move that work into it.
 * The Epic Map's "Create epic" button and the gap suggestions share these.
 */
export function claimOps(project: Project, mapping: Mapping, category: string, taskKeys: string[]): Op[] {
  const create = newItem(project, mapping, categoryName(category), { epic: true });
  const key = create[0]?.kind === "create" ? create[0].key : null;
  if (!key) return [];
  const byKey = new Map(project.items.map(i => [i.key, i]));
  const moves = taskKeys.flatMap(k => { const it = byKey.get(k); return it ? moveToParent(project, it, key) : []; });
  return [...create, ...moves];
}

/** The ops that split an epic: a new sibling epic takes one group of its tasks. */
export function splitOps(project: Project, mapping: Mapping, epic: Item, keys: string[]): Op[] {
  const base = splitItem(project, mapping, epic, `${epic.title} (part 2)`, keys);
  const created = base[0]?.kind === "create" ? base[0].key : null;
  if (!created) return [];
  const byKey = new Map(project.items.map(i => [i.key, i]));
  // Tasks that sat one level deeper (children of a sub-epic) move across by hand.
  const deeper = keys.flatMap(k => {
    const it = byKey.get(k);
    if (!it || it.parentKey === epic.key) return [];
    return [{ kind: "setParent", key: k, before: it.parentKey ?? null, after: created } as Op];
  });
  return [...base, ...deeper];
}

/**
 * Everything the map thinks is worth doing: move a task that fits better elsewhere, merge
 * two epics that overlap, split an epic that holds two kinds of work, or give a kind of
 * work an epic of its own. Sorted by how much each would raise the structure score.
 */
export function suggestions(model: EpicMapModel, project: Project, mapping: Mapping): Suggestion[] {
  const byKey = new Map(project.items.map(i => [i.key, i]));
  const titleOf = (k: string | null) => (k ? byKey.get(k)?.title ?? k : "no epic");
  const out: Suggestion[] = [];

  // The score after a change, so every suggestion can say what it is worth.
  const gainOf = (ops: Op[]) => {
    if (!ops.length || model.score === null) return 0;
    const next = analyze(applyOps(project, ops).project, mapping, { openOnly: model.openOnly });
    return (next.score ?? 0) - model.score;
  };

  for (const mv of model.moves) {
    const item = byKey.get(mv.taskKey);
    if (!item) continue;
    const ops = moveToParent(project, item, mv.to);
    if (!ops.length) continue;
    const own = model.tasks.find(t => t.key === mv.taskKey)?.ownSim ?? 0;
    out.push({
      id: `move:${mv.taskKey}`, kind: "move",
      title: `Move “${item.title}” to “${titleOf(mv.to)}”`,
      why: `It reads more like ${titleOf(mv.to)} (${pct(mv.sim)}) than ${titleOf(mv.from)} (${pct(own)}).`,
      gain: mv.gain, ops, epics: [mv.to], items: [mv.taskKey],
    });
  }

  for (const o of model.overlaps) {
    if (o.score < MERGE_SCORE) continue;
    const a = model.epics.find(e => e.key === o.a), b = model.epics.find(e => e.key === o.b);
    if (!a || !b) continue;
    // The bigger epic keeps its name; the smaller one folds into it.
    const survivor = a.taskKeys.length >= b.taskKeys.length ? a : b;
    const other = survivor === a ? b : a;
    if (!other.taskKeys.length) continue;
    const ops: Op[] = [];
    for (const k of other.taskKeys) {
      const it = byKey.get(k);
      if (it) ops.push(...moveToParent(project, it, survivor.key));
    }
    if (!ops.length) continue;
    ops.push({ kind: "archive", key: other.key });
    const shared = o.shared.length ? ` on ${o.shared.join(", ")}` : "";
    out.push({
      id: `merge:${[o.a, o.b].sort().join("|")}`, kind: "merge",
      title: `Merge “${other.title}” into “${survivor.title}”`,
      why: `They overlap by ${pct(o.score)}${shared}.`,
      gain: gainOf(ops), ops, epics: [survivor.key, other.key], items: other.taskKeys,
    });
  }

  for (const e of model.epics) {
    if (e.taskKeys.length < SPLIT_TASKS) continue;
    const epic = byKey.get(e.key);
    if (!epic) continue;
    const indices = model.tasks.map((t, i) => (t.epicKey === e.key ? i : -1)).filter(i => i >= 0);
    const groups = communities(indices, model.edges)
      .filter(g => g.length >= SPLIT_GROUP)
      .sort((a, b) => b.length - a.length);
    if (groups.length < 2) continue;
    // The smaller group moves out; the epic keeps the larger half.
    const second = groups[1]!;
    const keys = second.map(i => model.tasks[i]!.key);
    const ops = splitOps(project, mapping, epic, keys);
    if (!ops.length) continue;
    out.push({
      id: `split:${e.key}`, kind: "split",
      title: `Split “${e.title}” in two`,
      why: `Its ${e.taskKeys.length} tasks fall into two groups of ${groups[0]!.length} and ${second.length} that don't look alike.`,
      gain: gainOf(ops), ops, epics: [e.key], items: keys,
    });
  }

  for (const g of model.gaps) {
    const ops = claimOps(project, mapping, g.category, g.taskKeys);
    if (!ops.length) continue;
    out.push({
      id: `gap:${g.category}`, kind: "gap",
      title: `Give ${categoryName(g.category).toLowerCase()} work an epic of its own`,
      why: `${g.taskKeys.length} tasks are ${categoryName(g.category).toLowerCase()} work spread across other epics.`,
      gain: gainOf(ops), ops, epics: [], items: g.taskKeys,
    });
  }

  const order: Record<SuggestionKind, number> = { gap: 0, merge: 1, move: 2, split: 3 };
  return out.sort((x, y) => y.gain - x.gain || order[x.kind] - order[y.kind] || x.id.localeCompare(y.id));
}

/**
 * Hides suggestions you turned down, and ones you snoozed until later.
 * A snooze that has run out lets the suggestion come back.
 */
export function visibleSuggestions(list: Suggestion[], memory: SuggestionMemory, now = Date.now()): Suggestion[] {
  return list.filter(s => {
    const v = memory[s.id];
    if (!v) return true;
    if (v === "rejected") return false;
    const until = new Date(v.snoozedUntil).getTime();
    return Number.isFinite(until) && until <= now;
  });
}

/**
 * A suggestion built from an idea the model came up with: a new epic with its own name,
 * holding the work the model picked out. Keys that are not in the project are dropped.
 */
export function ideaSuggestion(model: EpicMapModel, project: Project, mapping: Mapping, idea: { title: string; why: string; taskKeys: string[] }): Suggestion | null {
  const byKey = new Map(project.items.map(i => [i.key, i]));
  const keys = [...new Set(idea.taskKeys)].filter(k => byKey.has(k));
  if (!keys.length) return null;
  const create = newItem(project, mapping, idea.title, { epic: true });
  const created = create[0]?.kind === "create" ? create[0].key : null;
  if (!created) return null;
  const ops: Op[] = [...create, ...keys.flatMap(k => moveToParent(project, byKey.get(k)!, created))];
  const next = analyze(applyOps(project, ops).project, mapping, { openOnly: model.openOnly });
  return {
    id: `gap-idea:${hashText(`${idea.title}|${keys.join(",")}`)}`,
    kind: "gap",
    title: `Give this work an epic: “${idea.title}”`,
    why: idea.why,
    gain: model.score === null ? 0 : (next.score ?? 0) - model.score,
    ops, epics: [], items: keys, byModel: true,
  };
}
