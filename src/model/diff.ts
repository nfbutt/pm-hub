// Plan history: compact baselines, the difference between two of them, and churn
// (how often and how far epics slipped, how much scope arrived after they started). Pure.
import { isEpic, laneOf, releaseOf, type Mapping } from "./mapping";
import type { Project } from "./normalize";
import { daysBetween, type Schedule } from "./schedule";

export interface BaselineItem {
  key: string; title: string; parentKey: string | null; epic: boolean;
  state: "open" | "closed" | "merged"; start: string | null; end: string | null;
  release: string | null; lane: string | null; sub: { total: number; done: number } | null;
}
export interface Baseline {
  version: 1; name: string; savedAt: string; auto: boolean;
  project: { owner: string; number: number; title: string };
  items: BaselineItem[];
}

export function snapshot(p: Project, m: Mapping, s: Schedule, name: string, auto = false, savedAt = new Date().toISOString()): Baseline {
  return {
    version: 1, name, savedAt, auto, project: { owner: p.owner, number: p.number, title: p.title },
    items: p.items.filter(i => i.kind !== "redacted").map(i => {
      const b = s.bars.get(i.key);
      return {
        key: i.key, title: i.title, parentKey: i.parentKey, epic: isEpic(i, m), state: i.state,
        start: b?.start ?? null, end: b?.end ?? null, release: releaseOf(i, m)?.title ?? null, lane: laneOf(i, m),
        sub: i.subIssues ? { total: i.subIssues.total, done: i.subIssues.completed } : null,
      };
    }),
  };
}

export interface DateMove { key: string; title: string; epic: boolean; fromEnd: string | null; toEnd: string | null; days: number | null }
export interface BaselineDiff {
  added: BaselineItem[];
  removed: BaselineItem[];
  reparented: { item: BaselineItem; from: string | null; to: string | null }[];
  moved: DateMove[];
  closed: BaselineItem[];
  reopened: BaselineItem[];
  renamed: { item: BaselineItem; from: string }[];
  releaseChanged: { item: BaselineItem; from: string | null; to: string | null }[];
}

/** What changed from `before` to `after`. Date moves are sorted by size, biggest slip first. */
export function diffBaselines(before: Baseline, after: Baseline): BaselineDiff {
  const old = new Map(before.items.map(i => [i.key, i]));
  const now = new Map(after.items.map(i => [i.key, i]));
  const d: BaselineDiff = { added: [], removed: [], reparented: [], moved: [], closed: [], reopened: [], renamed: [], releaseChanged: [] };
  for (const [k, i] of now) {
    const o = old.get(k);
    if (!o) { d.added.push(i); continue; }
    if (o.parentKey !== i.parentKey) d.reparented.push({ item: i, from: o.parentKey, to: i.parentKey });
    if (o.end !== i.end || (o.start !== i.start && o.end !== null)) {
      const days = o.end && i.end ? daysBetween(o.end, i.end) : null;
      if (days !== 0 || o.start !== i.start) d.moved.push({ key: k, title: i.title, epic: i.epic, fromEnd: o.end, toEnd: i.end, days });
    }
    if (o.state === "open" && i.state !== "open") d.closed.push(i);
    if (o.state !== "open" && i.state === "open") d.reopened.push(i);
    if (o.title !== i.title) d.renamed.push({ item: i, from: o.title });
    if (o.release !== i.release) d.releaseChanged.push({ item: i, from: o.release, to: i.release });
  }
  for (const [k, o] of old) if (!now.has(k)) d.removed.push(o);
  d.moved.sort((a, b) => Math.abs(b.days ?? 999) - Math.abs(a.days ?? 999));
  return d;
}

export interface EpicChurn { key: string; title: string; endMoves: number; slipDays: number; firstEnd: string | null; lastEnd: string | null }

/** Across baselines (any order), how many times each epic's end date moved and by how much in total. */
export function churnAcross(baselines: Baseline[]): EpicChurn[] {
  const ordered = [...baselines].sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  const out = new Map<string, EpicChurn>();
  for (const b of ordered) for (const i of b.items) {
    if (!i.epic) continue;
    const c = out.get(i.key);
    if (!c) { out.set(i.key, { key: i.key, title: i.title, endMoves: 0, slipDays: 0, firstEnd: i.end, lastEnd: i.end }); continue; }
    c.title = i.title;
    if (i.end !== c.lastEnd) {
      c.endMoves++;
      if (c.lastEnd && i.end) c.slipDays += daysBetween(c.lastEnd, i.end);
      c.lastEnd = i.end;
    }
  }
  return [...out.values()].filter(c => c.endMoves > 0).sort((a, b) => b.slipDays - a.slipDays || b.endMoves - a.endMoves);
}

/** Per epic: sub-issues created after the epic's own start date (scope that arrived mid-flight). */
export function scopeAddedAfterStart(p: Project, m: Mapping, s: Schedule): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of p.items) {
    if (!isEpic(e, m)) continue;
    const start = s.bars.get(e.key)?.start;
    if (!start) continue;
    const n = (s.children.get(e.key) ?? []).filter(c => c.createdAt && c.createdAt.slice(0, 10) > start).length;
    if (n) out.set(e.key, n);
  }
  return out;
}

/** Days the current end is later (+) or earlier (−) than the baseline's, for "Compare to" labels. */
export function versusBaseline(b: Baseline, key: string, currentEnd: string | null): number | null {
  const o = b.items.find(i => i.key === key);
  return o?.end && currentEnd ? daysBetween(o.end, currentEnd) : null;
}
