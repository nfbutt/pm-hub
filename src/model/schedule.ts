// Turns items into dated bars, rolls epics up from their children, overlays a local
// draft, and finds dependency conflicts. Dates are ISO "YYYY-MM-DD" strings in UTC.
import { addDays, isEpic, laneOf, releaseOf, type Mapping } from "./mapping";
import type { Item, Project } from "./normalize";

export type BarSource = "fields" | "iteration" | "milestone" | "children" | "draft";

export interface Bar {
  key: string;
  start: string;
  end: string;
  source: BarSource;
  /** True when only one date is known, e.g. a milestone due date. */
  deadlineOnly: boolean;
}

export interface Draft {
  bars: Record<string, { start: string; end: string }>;
  order: Record<string, string[]>;
  parked: string[];
}
export const emptyDraft = (): Draft => ({ bars: {}, order: {}, parked: [] });

const DAY = 86_400_000;
export const toTime = (d: string) => Date.parse(d.slice(0, 10) + "T00:00:00Z");
export const daysBetween = (a: string, b: string) => Math.round((toTime(b) - toTime(a)) / DAY);
const minD = (a: string, b: string) => (a < b ? a : b);
const maxD = (a: string, b: string) => (a > b ? a : b);

function dateField(i: Item, name: string | null): string | null {
  if (!name) return null;
  const v = i.fields[name];
  return v?.kind === "date" ? v.date.slice(0, 10) : null;
}

/** The item's own bar, ignoring children and drafts. */
export function ownBar(i: Item, m: Mapping): Bar | null {
  const s = dateField(i, m.startField), e = dateField(i, m.endField);
  if (s || e) {
    const start = s ?? e!, end = e ?? s!;
    return { key: i.key, start: minD(start, end), end: maxD(start, end), source: "fields", deadlineOnly: !s || !e };
  }
  if (m.iterationField) {
    const v = i.fields[m.iterationField];
    if (v?.kind === "iteration") return { key: i.key, start: v.startDate, end: addDays(v.startDate, v.duration - 1), source: "iteration", deadlineOnly: false };
  }
  if (m.milestoneDates && i.milestone?.dueOn) {
    const due = i.milestone.dueOn.slice(0, 10);
    return { key: i.key, start: due, end: due, source: "milestone", deadlineOnly: true };
  }
  return null;
}

export interface Schedule {
  bars: Map<string, Bar>;
  children: Map<string, Item[]>;
  byKey: Map<string, Item>;
}

/** Bars for every item; epics without their own dates take the span of their children. */
export function buildSchedule(p: Project, m: Mapping, draft: Draft = emptyDraft()): Schedule {
  const byKey = new Map(p.items.map(i => [i.key, i]));
  const children = new Map<string, Item[]>();
  for (const i of p.items) if (i.parentKey) {
    if (!children.has(i.parentKey)) children.set(i.parentKey, []);
    children.get(i.parentKey)!.push(i);
  }
  const bars = new Map<string, Bar>();
  for (const i of p.items) { const b = ownBar(i, m); if (b) bars.set(i.key, b); }

  // Roll up from children, deepest first, so nested epics work.
  const depth = (i: Item, seen = new Set<string>()): number => {
    if (!i.parentKey || seen.has(i.key)) return 0;
    seen.add(i.key);
    const parent = byKey.get(i.parentKey);
    return parent ? 1 + depth(parent, seen) : 0;
  };
  const parents = [...children.keys()].map(k => byKey.get(k)).filter((i): i is Item => !!i).sort((a, b) => depth(b) - depth(a));
  for (const parent of parents) {
    const own = bars.get(parent.key);
    if (own && !own.deadlineOnly) continue;
    const spans = (children.get(parent.key) ?? []).map(c => bars.get(c.key)).filter((b): b is Bar => !!b);
    if (!spans.length) continue;
    let start = spans.map(b => b.start).reduce(minD), end = spans.map(b => b.end).reduce(maxD);
    if (own) { start = minD(start, own.start); end = maxD(end, own.end); }
    bars.set(parent.key, { key: parent.key, start, end, source: "children", deadlineOnly: false });
  }

  for (const [key, d] of Object.entries(draft.bars)) {
    if (byKey.has(key)) bars.set(key, { key, start: d.start, end: d.end, source: "draft", deadlineOnly: false });
  }
  return { bars, children, byKey };
}

export interface Conflict { key: string; blocker: string; message: string }

/** An open item that starts before something blocking it is due to finish. */
export function findConflicts(s: Schedule, draft: Draft = emptyDraft()): Conflict[] {
  const out: Conflict[] = [];
  for (const [key, item] of s.byKey) {
    if (item.state !== "open" || draft.parked.includes(key)) continue;
    const bar = s.bars.get(key);
    if (!bar) continue;
    for (const ref of item.blockedBy) {
      if (!ref.open) continue;
      const blocker = s.bars.get(ref.key);
      if (!blocker || draft.parked.includes(ref.key)) continue;
      // Sprint and milestone bars are coarse: two dependent tasks in one sprint is normal,
      // so only a blocker scheduled to *start* later counts as a conflict there.
      const coarse = (b: Bar) => b.source === "iteration" || b.source === "milestone";
      const clash = coarse(bar) || coarse(blocker) ? blocker.start > bar.start : blocker.end >= bar.start;
      if (clash) {
        out.push({ key, blocker: ref.key, message: `Starts ${bar.start}, but ${ref.key} isn't due to finish until ${blocker.end}` });
      }
    }
  }
  return out;
}

export interface Row { item: Item; lane: string; bar: Bar | null; depth: number; moved: boolean; original: Bar | null }

/** Epic rows grouped by lane, ordered by the draft or by start date. */
export function ganttRows(p: Project, m: Mapping, s: Schedule, draft: Draft, opts: { includeClosed: boolean; expanded: Set<string> }) {
  const original = buildSchedule(p, m);
  const epics = p.items.filter(i => isEpic(i, m) && (opts.includeClosed || i.state === "open"));
  const lanes = new Map<string, Item[]>();
  for (const e of epics) {
    const lane = laneOf(e, m) ?? "No lane";
    if (!lanes.has(lane)) lanes.set(lane, []);
    lanes.get(lane)!.push(e);
  }
  const startOf = (i: Item) => s.bars.get(i.key)?.start ?? "9999";
  const laneList = [...lanes.keys()].sort((a, b) => (a === "No lane" ? 1 : b === "No lane" ? -1 : a.localeCompare(b)));
  const makeRow = (item: Item, lane: string, depth: number): Row => {
    const bar = draft.parked.includes(item.key) ? null : s.bars.get(item.key) ?? null;
    const orig = original.bars.get(item.key) ?? null;
    return { item, lane, depth, bar, original: orig, moved: !!draft.bars[item.key] };
  };
  return laneList.map(lane => {
    const items = lanes.get(lane)!;
    const order = draft.order[lane];
    items.sort((a, b) => {
      if (order) {
        const ia = order.indexOf(a.key), ib = order.indexOf(b.key);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
      }
      return startOf(a).localeCompare(startOf(b)) || a.title.localeCompare(b.title);
    });
    const rows: Row[] = [];
    for (const e of items) {
      if (draft.parked.includes(e.key)) continue;
      rows.push(makeRow(e, lane, 0));
      if (opts.expanded.has(e.key)) {
        const kids = (s.children.get(e.key) ?? []).filter(c => opts.includeClosed || c.state === "open")
          .sort((a, b) => startOf(a).localeCompare(startOf(b)));
        for (const c of kids) rows.push(makeRow(c, lane, 1));
      }
    }
    return { lane, rows, undated: rows.filter(r => r.depth === 0 && !r.bar).map(r => r.item) };
  });
}

/** Visible window: from the earliest bar to the latest, padded, aligned to Mondays. */
export function timeWindow(bars: Iterable<Bar>, today: string, extra: string[] = []): { start: string; end: string } {
  let lo = today, hi = today;
  for (const b of bars) { lo = minD(lo, b.start); hi = maxD(hi, b.end); }
  for (const d of extra) { lo = minD(lo, d); hi = maxD(hi, d); }
  const mondayOf = (d: string) => addDays(d, -((new Date(toTime(d)).getUTCDay() + 6) % 7));
  return { start: mondayOf(addDays(lo, -7)), end: addDays(mondayOf(addDays(hi, 14)), 6) };
}

export interface ReleaseColumn { id: string; title: string; due: string | null; items: Item[]; done: number; late: Item[] }

/** Items grouped by release, ordered by due date. Items whose bar ends after the release is due are flagged. */
export function releaseColumns(p: Project, m: Mapping, s: Schedule): ReleaseColumn[] {
  const cols = new Map<string, ReleaseColumn>();
  for (const i of p.items) {
    const r = releaseOf(i, m);
    if (!r) continue;
    // Milestones with the same title in several repos are one release.
    const id = m.release.kind === "milestone" ? `title:${r.title}` : r.id;
    if (!cols.has(id)) cols.set(id, { id, title: r.title, due: r.due, items: [], done: 0, late: [] });
    const c = cols.get(id)!;
    if (r.due && (!c.due || r.due > c.due)) c.due = r.due;
    c.items.push(i);
    if (i.state !== "open") c.done++;
  }
  for (const c of cols.values()) {
    c.late = c.due ? c.items.filter(i => i.state === "open" && (s.bars.get(i.key)?.end ?? "") > c.due!) : [];
  }
  return [...cols.values()].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.title.localeCompare(b.title));
}
