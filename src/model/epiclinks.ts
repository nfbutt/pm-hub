// The epics as a graph: what waits for what, and what covers the same ground. A link
// drawn between two epics is an ordinary "blocked by" between their issues, so the
// Roadmap, the Gantt and the plan check all see it. Pure: the view renders this and
// records the ops it returns.
import { addBlocker, removeBlocker } from "./edits";
import type { EpicMapModel } from "./epicmap";
import { isEpic, type Mapping } from "./mapping";
import type { Item, Project } from "./normalize";
import type { Op } from "./ops";
import { wouldLoop, type Plan } from "./plan/cpm";
import { evidenceFound } from "./plan/infer";
import { epicRelease, workOf } from "./releases";

export interface EpicNode {
  key: string;
  title: string;
  number: number | null;
  release: string | null;
  total: number;
  done: number;
  start: string | null;
  end: string | null;
  critical: boolean;
}

/**
 * `direct`: the epic's own issue is blocked by the other epic, so it can be removed here.
 * `stories`: the link comes from their stories; it is changed on the stories.
 */
export type EdgeKind = "direct" | "stories";

export interface EpicEdge {
  /** The epic that has to finish first. */
  from: string;
  /** The epic that waits. */
  to: string;
  kind: EdgeKind;
  /** The story links behind it: [blocking story, waiting story]. */
  via: [string, string][];
  critical: boolean;
}

export interface EpicOverlap { a: string; b: string; score: number; shared: string[] }

export interface EpicGraph {
  nodes: EpicNode[];
  edges: EpicEdge[];
  overlaps: EpicOverlap[];
  /** Epics that wait for each other in a circle. */
  loops: string[][];
}

/** The epic an item rolls up to: itself, or its nearest epic ancestor. */
function epicOf(item: Item, mapping: Mapping, byKey: Map<string, Item>): string | null {
  if (isEpic(item, mapping)) return item.key;
  const seen = new Set<string>();
  for (let k = item.parentKey; k && !seen.has(k); k = byKey.get(k)?.parentKey ?? null) {
    seen.add(k);
    const p = byKey.get(k);
    if (p && isEpic(p, mapping)) return p.key;
  }
  return null;
}

/** The open epics, the links between them, and where two of them overlap. */
export function epicGraph(project: Project, mapping: Mapping, plan: Plan, map: EpicMapModel | null): EpicGraph {
  const byKey = new Map(project.items.map(i => [i.key, i]));
  const epics = project.items.filter(i => isEpic(i, mapping) && i.state === "open");
  const open = new Set(epics.map(e => e.key));

  const nodes: EpicNode[] = epics.map(e => {
    const work = workOf(project, mapping, e, byKey);
    const p = plan.epics.get(e.key);
    return {
      key: e.key, title: e.title, number: e.number,
      release: epicRelease(project, mapping, e, work)?.title ?? null,
      total: work.length, done: work.filter(w => w.state !== "open").length,
      start: p?.start ?? null, end: p?.end ?? null, critical: !!p?.critical,
    };
  });

  const edges = new Map<string, EpicEdge>();
  const critical = new Set(plan.links.filter(l => l.critical).map(l => `${l.from}>${l.to}`));
  const edge = (from: string, to: string) => {
    const id = `${from}>${to}`;
    let e = edges.get(id);
    if (!e) { e = { from, to, kind: "stories", via: [], critical: critical.has(id) }; edges.set(id, e); }
    return e;
  };
  for (const item of project.items) {
    const to = epicOf(item, mapping, byKey);
    if (!to || !open.has(to)) continue;
    for (const b of item.blockedBy) {
      const blocker = byKey.get(b.key);
      if (!blocker) continue;
      const from = epicOf(blocker, mapping, byKey);
      if (!from || from === to || !open.has(from)) continue;
      const e = edge(from, to);
      // The epic's own issue waiting for the other epic's own issue is a link made at epic level.
      if (item.key === to && blocker.key === from) e.kind = "direct";
      else e.via.push([blocker.key, item.key]);
    }
  }

  const overlaps = (map?.overlaps ?? []).filter(o => open.has(o.a) && open.has(o.b)).map(o => ({ a: o.a, b: o.b, score: o.score, shared: o.shared }));
  const loops = plan.problems.filter(p => p.kind === "cycle").map(p => p.keys);
  return { nodes, edges: [...edges.values()], overlaps, loops };
}

/** Can `waiting` be made to wait for `blocker`? And if not, why not, in words. */
export function canLink(project: Project, plan: Plan, blockerKey: string, waitingKey: string): { ok: boolean; why: string | null } {
  if (blockerKey === waitingKey) return { ok: false, why: "An epic cannot wait for itself." };
  const waiting = project.items.find(i => i.key === waitingKey);
  if (!waiting) return { ok: false, why: "That epic is not in the project." };
  if (waiting.blockedBy.some(b => b.key === blockerKey)) return { ok: false, why: "That link is already there." };
  if (wouldLoop(plan.links, blockerKey, waitingKey)) return { ok: false, why: "That would make the two epics wait for each other." };
  return { ok: true, why: null };
}

/** `waiting` cannot start until `blocker` is done. */
export function linkEpics(project: Project, plan: Plan, blocker: Item, waiting: Item): Op[] {
  return canLink(project, plan, blocker.key, waiting.key).ok ? addBlocker(project, waiting, blocker.key) : [];
}

/** Takes a direct link away. A link that comes from stories has to be changed on them. */
export function unlinkEpics(blocker: Item, waiting: Item): Op[] {
  return removeBlocker(waiting, blocker.key);
}

// ---------------------------------------------------------------- finding links in the text

export interface EpicLinkHint {
  id: string;
  /** Has to finish first. */
  from: string;
  /** Waits. */
  to: string;
  fromTitle: string;
  toTitle: string;
  /** The words that say so, copied from one of the issues. */
  evidence: string;
  /** The issue the words are in. */
  evidenceIn: string;
  source: "text" | "model";
  ops: Op[];
}

/** Words that say one thing comes after another. */
const CUE = /\b(depends? on|dependent on|blocked by|waits? (?:for|on)|after|once|requires?|required|needs?|prerequisite|builds? on|on top of|relies on|uses the|until)\b/i;

/** Words too common in plans to say which epic a sentence is about. */
const COMMON = new Set([
  "with", "from", "into", "that", "this", "their", "there", "when", "then", "than", "will", "have", "page", "flow", "data", "work",
  "build", "design", "test", "support", "add", "new", "update", "make", "user", "users", "team", "plan", "release", "version",
]);

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !COMMON.has(w));

/** Does the text name this epic: its whole title, or at least two of its own words? */
function names(text: string, epic: Item): boolean {
  const lower = text.toLowerCase();
  if (lower.includes(epic.title.toLowerCase())) return true;
  const own = new Set(words(epic.title));
  const hit = words(text).filter(w => own.has(w));
  return new Set(hit).size >= Math.min(2, own.size);
}

/**
 * Is the quote really in the item? A model often quotes a story as "title — sentence",
 * the way it was shown them: each part has to be in the same issue, word for word.
 */
function quoteIn(quote: string, item: Item): boolean {
  if (evidenceFound(quote, item)) return true;
  const parts = quote.split(/\s+[—–]\s+/).map(p => p.trim()).filter(p => p.length >= 4);
  return parts.length > 1 && parts.every(p => evidenceFound(p, item));
}

/** The sentences of a text, as they are written, so a quote of one is found again exactly. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s.length >= 12 && s.length <= 240);
}

/**
 * Links the issues themselves state: a sentence in an epic or one of its stories that says
 * it depends on, needs or comes after another epic — by its number, its stories' numbers,
 * or the words of its title. No model is needed, and the quote is the reason.
 */
export function textHints(project: Project, mapping: Mapping, plan: Plan, graph: EpicGraph): EpicLinkHint[] {
  const byKey = new Map(project.items.map(i => [i.key, i]));
  const epics = graph.nodes.map(n => byKey.get(n.key)).filter((e): e is Item => !!e);
  const linked = new Set(graph.edges.map(e => `${e.from}>${e.to}`));
  const work = new Map(epics.map(e => [e.key, workOf(project, mapping, e, byKey)]));

  // What points at each epic: its number and its stories' numbers, and its title's own words.
  const refs = epics.map(e => {
    const others = new Set(epics.filter(x => x.key !== e.key).flatMap(x => words(x.title)));
    return {
      epic: e,
      numbers: new Set([e, ...(work.get(e.key) ?? [])].filter(i => i.number !== null && i.repo === e.repo).map(i => i.number!)),
      // Words of its title no other epic's title has: they name this epic and only this one.
      own: words(e.title).filter(w => !others.has(w)),
      title: e.title.toLowerCase(),
    };
  });

  const out: EpicLinkHint[] = [];
  const seen = new Set<string>();
  for (const waiting of epics) {
    for (const source of [waiting, ...(work.get(waiting.key) ?? [])]) {
      if (source.state !== "open") continue;
      for (const sentence of sentences(`${source.title}.\n${source.body ?? ""}`)) {
        if (!CUE.test(sentence)) continue;
        const lower = sentence.toLowerCase();
        const nums = new Set([...sentence.matchAll(/#(\d+)/g)].map(m => Number(m[1])));
        const hit = new Set(words(sentence));
        for (const r of refs) {
          const blocker = r.epic;
          if (blocker.key === waiting.key) continue;
          const named = lower.includes(r.title)
            || [...nums].some(n => r.numbers.has(n))
            || (r.own.length >= 1 && r.own.filter(w => hit.has(w)).length >= Math.min(2, r.own.length));
          if (!named) continue;
          const id = `${blocker.key}>${waiting.key}`;
          if (seen.has(id) || linked.has(id)) continue;
          if (wouldLoop(plan.links, blocker.key, waiting.key)) continue;
          if (!evidenceFound(sentence, source)) continue;
          const ops = addBlocker(project, waiting, blocker.key);
          if (!ops.length) continue;
          seen.add(id);
          out.push({
            id: `hint:${id}`, from: blocker.key, to: waiting.key, fromTitle: blocker.title, toTitle: waiting.title,
            evidence: sentence, evidenceIn: source.title, source: "text", ops,
          });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- what a model said

export interface ProposedEpicLink { from: string; to: string; evidence: string }

/**
 * Keeps the links a model proposed that hold up: two open epics, not already linked, no
 * loop, and a reason that is a quote really found in either epic or in one of their
 * stories. Anything else is dropped, with the reason.
 */
export function checkEpicLinks(project: Project, mapping: Mapping, plan: Plan, graph: EpicGraph, proposed: ProposedEpicLink[]): { accepted: EpicLinkHint[]; dropped: { proposed: ProposedEpicLink; reason: string }[] } {
  const byKey = new Map(project.items.map(i => [i.key, i]));
  const open = new Set(graph.nodes.map(n => n.key));
  const linked = new Set(graph.edges.map(e => `${e.from}>${e.to}`));
  const accepted: EpicLinkHint[] = [];
  const dropped: { proposed: ProposedEpicLink; reason: string }[] = [];
  const seen = new Set<string>();
  for (const p of proposed) {
    const from = byKey.get(p.from), to = byKey.get(p.to);
    if (!from || !to || !open.has(from.key) || !open.has(to.key)) { dropped.push({ proposed: p, reason: "one of them is not an open epic here" }); continue; }
    if (from.key === to.key) { dropped.push({ proposed: p, reason: "an epic cannot wait for itself" }); continue; }
    const id = `${from.key}>${to.key}`;
    if (linked.has(id)) { dropped.push({ proposed: p, reason: "that link is already there" }); continue; }
    if (wouldLoop(plan.links, from.key, to.key)) { dropped.push({ proposed: p, reason: "it would make the epics wait for each other" }); continue; }
    const quote = (p.evidence ?? "").trim();
    const fromSide = [from, ...workOf(project, mapping, from, byKey)], toSide = [to, ...workOf(project, mapping, to, byKey)];
    const where = [...fromSide, ...toSide].find(i => quoteIn(quote, i));
    if (!where) { dropped.push({ proposed: p, reason: "the reason could not be found in either epic or their stories" }); continue; }
    // A real sentence is not a reason unless it says something about order: words of
    // dependency, or the other epic by name. "Covers the invoice layout" is neither.
    const other = fromSide.includes(where) ? to : from;
    if (!CUE.test(quote) && !names(quote, other)) { dropped.push({ proposed: p, reason: "the quote does not say that one waits for the other" }); continue; }
    if (seen.has(id)) continue;
    const ops = addBlocker(project, to, from.key);
    if (!ops.length) { dropped.push({ proposed: p, reason: "the change could not be made" }); continue; }
    seen.add(id);
    accepted.push({ id: `model:${id}`, from: from.key, to: to.key, fromTitle: from.title, toTitle: to.title, evidence: quote, evidenceIn: where.title, source: "model", ops });
  }
  return { accepted, dropped };
}

/**
 * Lays the epics out in columns by how deep they are in the chain: the ones that wait for
 * nothing on the left, each one after everything it waits for. Within a column, by start.
 * Deterministic, so the picture does not move about between visits.
 */
export function layers(graph: EpicGraph): string[][] {
  const preds = new Map(graph.nodes.map(n => [n.key, [] as string[]]));
  for (const e of graph.edges) preds.get(e.to)?.push(e.from);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (k: string): number => {
    const known = depth.get(k);
    if (known !== undefined) return known;
    // A loop has no bottom: count it as level with what it came from.
    if (visiting.has(k)) return 0;
    visiting.add(k);
    const d = Math.max(-1, ...(preds.get(k) ?? []).map(depthOf)) + 1;
    visiting.delete(k);
    depth.set(k, d);
    return d;
  };
  const cols: EpicNode[][] = [];
  for (const n of graph.nodes) (cols[depthOf(n.key)] ??= []).push(n);
  return cols.filter(Boolean).map(col => col
    .sort((a, b) => (a.start ?? "9999").localeCompare(b.start ?? "9999") || a.title.localeCompare(b.title))
    .map(n => n.key));
}
