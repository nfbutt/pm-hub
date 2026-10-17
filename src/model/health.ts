// Progress, hygiene and workload. Pure functions over the project and its schedule.
import { addDays, isEpic, laneOf, releaseOf, statusOf, type Mapping } from "./mapping";
import type { Item, Project } from "./normalize";
import { daysBetween, type Schedule } from "./schedule";

export type Health = "done" | "on-track" | "behind" | "at-risk" | "overdue" | "not-started" | "no-dates";

export interface EpicHealth {
  item: Item; lane: string | null;
  done: number; total: number; pctDone: number;
  /** Share of the bar's time that has passed, 0-100. Null without dates. */
  pctTime: number | null;
  health: Health;
  start: string | null; end: string | null;
  daysLeft: number | null;
}

/** Thresholds, in percentage points of "time passed minus work done". */
export const BEHIND_AT = 10;
export const AT_RISK_AT = 25;

export function epicHealth(item: Item, m: Mapping, s: Schedule, today: string): EpicHealth {
  const kids = s.children.get(item.key) ?? [];
  const total = item.subIssues?.total ?? kids.length;
  const done = item.subIssues?.completed ?? kids.filter(k => k.state !== "open").length;
  const pctDone = total ? Math.round((100 * done) / total) : item.state === "open" ? 0 : 100;
  const bar = s.bars.get(item.key) ?? null;
  const base = { item, lane: laneOf(item, m), done, total, pctDone, start: bar?.start ?? null, end: bar?.end ?? null };
  if (item.state !== "open") return { ...base, pctTime: 100, health: "done", daysLeft: null };
  if (!bar) return { ...base, pctTime: null, health: "no-dates", daysLeft: null };
  const length = daysBetween(bar.start, bar.end) + 1;
  const elapsed = Math.min(length, Math.max(0, daysBetween(bar.start, today) + 1));
  const pctTime = Math.round((100 * elapsed) / length);
  const daysLeft = daysBetween(today, bar.end);
  let health: Health;
  if (today < bar.start) health = "not-started";
  else if (today > bar.end) health = "overdue";
  else {
    const gap = pctTime - pctDone;
    health = gap > AT_RISK_AT ? "at-risk" : gap > BEHIND_AT ? "behind" : "on-track";
  }
  return { ...base, pctTime, health, daysLeft };
}

export function allEpicHealth(p: Project, m: Mapping, s: Schedule, today: string, includeClosed = false): EpicHealth[] {
  const order: Record<Health, number> = { overdue: 0, "at-risk": 1, behind: 2, "on-track": 3, "not-started": 4, "no-dates": 5, done: 6 };
  return p.items.filter(i => isEpic(i, m) && (includeClosed || i.state === "open"))
    .map(i => epicHealth(i, m, s, today))
    .sort((a, b) => order[a.health] - order[b.health] || (a.end ?? "9999").localeCompare(b.end ?? "9999"));
}

export interface Hygiene { noDates: Item[]; noAssignee: Item[]; noRelease: Item[]; stale: Item[]; blockedByClosed: Item[] }

export function hygiene(p: Project, m: Mapping, s: Schedule, today: string, staleDays = 30): Hygiene {
  const open = p.items.filter(i => i.state === "open" && i.kind !== "redacted");
  const staleBefore = addDays(today, -staleDays);
  return {
    noDates: open.filter(i => !s.bars.has(i.key)),
    noAssignee: open.filter(i => i.kind !== "draft" && i.assignees.length === 0 && !isEpic(i, m)),
    noRelease: m.release.kind === "none" ? [] : open.filter(i => !isEpic(i, m) && !releaseOf(i, m)),
    stale: open.filter(i => i.updatedAt && i.updatedAt.slice(0, 10) < staleBefore),
    blockedByClosed: open.filter(i => i.blockedBy.some(b => !b.open)),
  };
}

export interface StatusCount { status: string; count: number }

/** Counts by the status field, in the field's own option order. */
export function statusCounts(p: Project, m: Mapping, includeClosed = false): StatusCount[] {
  const items = p.items.filter(i => includeClosed || i.state === "open");
  const counts = new Map<string, number>();
  for (const i of items) { const st = statusOf(i, m) ?? "No status"; counts.set(st, (counts.get(st) ?? 0) + 1); }
  const field = p.fields.find(f => f.name === m.statusField);
  const order = field?.kind === "single" ? field.options.map(o => o.name) : [];
  return [...counts.entries()].map(([status, count]) => ({ status, count }))
    .sort((a, b) => {
      const ia = order.indexOf(a.status), ib = order.indexOf(b.status);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || b.count - a.count;
    });
}

export interface PersonLoad { login: string; open: Item[]; weekly: number[] }

/** Open work per assignee, and how many of their dated items overlap each week. */
export function workload(p: Project, s: Schedule, weekStarts: string[]): PersonLoad[] {
  const people = new Map<string, Item[]>();
  for (const i of p.items) {
    if (i.state !== "open") continue;
    const owners = i.assignees.length ? i.assignees : ["Unassigned"];
    for (const o of owners) { if (!people.has(o)) people.set(o, []); people.get(o)!.push(i); }
  }
  return [...people.entries()].map(([login, open]) => ({
    login, open,
    weekly: weekStarts.map(ws => {
      const we = addDays(ws, 6);
      return open.filter(i => { const b = s.bars.get(i.key); return b && b.start <= we && b.end >= ws; }).length;
    }),
  })).sort((a, b) => (a.login === "Unassigned" ? 1 : b.login === "Unassigned" ? -1 : b.open.length - a.open.length));
}

// ----- calendar -----

export type CalEventKind = "release" | "start" | "end" | "iteration";
export interface CalEvent { date: string; kind: CalEventKind; label: string; key?: string }

export function calendarEvents(p: Project, m: Mapping, s: Schedule, opts: { epicsOnly: boolean }): CalEvent[] {
  const out: CalEvent[] = [];
  const seenRelease = new Set<string>();
  for (const i of p.items) {
    const r = releaseOf(i, m);
    if (r?.due && !seenRelease.has(r.title + r.due)) { seenRelease.add(r.title + r.due); out.push({ date: r.due, kind: "release", label: r.title }); }
    if (i.state !== "open" || (opts.epicsOnly && !isEpic(i, m))) continue;
    const b = s.bars.get(i.key);
    if (!b) continue;
    if (b.start !== b.end) out.push({ date: b.start, kind: "start", label: i.title, key: i.key });
    out.push({ date: b.end, kind: "end", label: i.title, key: i.key });
  }
  const iter = p.fields.find(f => f.kind === "iteration" && f.name === m.iterationField);
  if (iter?.kind === "iteration") for (const it of iter.iterations) out.push({ date: it.startDate, kind: "iteration", label: it.title });
  const rank: Record<CalEventKind, number> = { release: 0, iteration: 1, end: 2, start: 3 };
  return out.sort((a, b) => a.date.localeCompare(b.date) || rank[a.kind] - rank[b.kind]);
}

/** 6x7 grid of dates for the month containing `month` (YYYY-MM), weeks starting Monday. */
export function monthGrid(month: string): string[] {
  const first = month + "-01";
  const dow = (new Date(first + "T00:00:00Z").getUTCDay() + 6) % 7;
  const start = addDays(first, -dow);
  return Array.from({ length: 42 }, (_, k) => addDays(start, k));
}
