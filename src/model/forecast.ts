// Throughput, burn-up and Monte Carlo delivery forecasts. Pure and seeded, so testable.
import { addDays, isEpic, releaseOf, type Mapping } from "./mapping";
import type { Item, Project } from "./normalize";
import { daysBetween } from "./schedule";

export const mondayOf = (d: string) => addDays(d, -((new Date(d.slice(0, 10) + "T00:00:00Z").getUTCDay() + 6) % 7));

/** Units of work: issues and PRs that aren't epics. Epics close when their parts do. */
export function workItems(p: Project, m: Mapping): Item[] {
  return p.items.filter(i => (i.kind === "issue" || i.kind === "pr") && !isEpic(i, m));
}

const closedOn = (i: Item) => (i.state !== "open" && i.closedAt ? i.closedAt.slice(0, 10) : null);

/** Items closed in each of the `weeks` full weeks before the week containing `today`. Oldest first. */
export function weeklyThroughput(items: Item[], today: string, weeks = 12): { weekStart: string; closed: number }[] {
  const thisWeek = mondayOf(today);
  return Array.from({ length: weeks }, (_, k) => {
    const ws = addDays(thisWeek, -(weeks - k) * 7), we = addDays(ws, 6);
    return { weekStart: ws, closed: items.filter(i => { const c = closedOn(i); return c !== null && c >= ws && c <= we; }).length };
  });
}

export interface BurnPoint { weekStart: string; scope: number; done: number }

/** Cumulative scope (created) and done (closed) at the end of each week, from the first item to `today`. */
export function burnup(items: Item[], today: string): BurnPoint[] {
  const created = items.map(i => i.createdAt?.slice(0, 10)).filter((d): d is string => !!d).sort();
  if (!created.length) return [];
  const out: BurnPoint[] = [];
  for (let ws = mondayOf(created[0]!); ws <= today; ws = addDays(ws, 7)) {
    const we = addDays(ws, 6);
    out.push({
      weekStart: ws,
      scope: items.filter(i => i.createdAt && i.createdAt.slice(0, 10) <= we).length,
      done: items.filter(i => { const c = closedOn(i); return c !== null && c <= we; }).length,
    });
  }
  return out;
}

/** Straight-line finish at the average of the recent weeks. Null when nothing has been closed lately. */
export function linearProjection(remaining: number, samples: number[], today: string): { weeks: number; date: string; rate: number } | null {
  const rate = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
  if (remaining <= 0) return { weeks: 0, date: today, rate };
  if (rate <= 0) return null;
  const weeks = Math.ceil(remaining / rate);
  return { weeks, date: addDays(mondayOf(today), weeks * 7 - 1), rate };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MonteCarlo {
  runs: number;
  /** weeksNeeded[k] = number of runs that finished in exactly k weeks (index capped at maxWeeks). */
  histogram: number[];
  p50: number; p85: number; p95: number;
  /** Runs that hadn't finished within maxWeeks. */
  unfinished: number;
}

/** Weeks needed to close `remaining` items, drawing each week's throughput at random from `samples`. */
export function monteCarloWeeks(remaining: number, samples: number[], opts: { runs?: number; seed?: number; maxWeeks?: number } = {}): MonteCarlo | null {
  const runs = opts.runs ?? 10_000, maxWeeks = opts.maxWeeks ?? 104;
  if (remaining <= 0) return { runs, histogram: [runs], p50: 0, p85: 0, p95: 0, unfinished: 0 };
  if (!samples.length || samples.every(s => s === 0)) return null;
  const rnd = mulberry32(opts.seed ?? 1);
  const histogram = new Array<number>(maxWeeks + 1).fill(0);
  let unfinished = 0;
  for (let r = 0; r < runs; r++) {
    let left = remaining, w = 0;
    while (left > 0 && w < maxWeeks) { left -= samples[Math.floor(rnd() * samples.length)]!; w++; }
    if (left > 0) unfinished++; else histogram[w]!++;
  }
  const pct = (q: number) => {
    const target = Math.ceil(q * runs);
    let acc = 0;
    for (let w = 0; w < histogram.length; w++) { acc += histogram[w]!; if (acc >= target) return w; }
    return Infinity;
  };
  return { runs, histogram, p50: pct(0.5), p85: pct(0.85), p95: pct(0.95), unfinished };
}

/** Share of runs finished within `weeks` weeks. */
export function chanceWithin(mc: MonteCarlo, weeks: number): number {
  if (weeks < 0) return 0;
  let acc = 0;
  for (let w = 0; w <= Math.min(weeks, mc.histogram.length - 1); w++) acc += mc.histogram[w]!;
  return acc / mc.runs;
}

/** Whole weeks from the start of this week until the end of the week containing `due`. */
export const weeksUntil = (today: string, due: string) => Math.floor(daysBetween(mondayOf(today), mondayOf(due)) / 7) + 1;

export interface ReleaseForecast {
  id: string; title: string; due: string | null;
  total: number; open: number;
  /** Open items in this release and every release due before it. */
  cumulativeOpen: number;
  mc: MonteCarlo | null;
  chance: number | null;
  p50Date: string | null; p85Date: string | null;
}

export interface ForecastInputs { samples: number[]; weeksOfHistory: number; closedInHistory: number; thin: boolean }

export function forecastInputs(p: Project, m: Mapping, today: string, weeks = 12): ForecastInputs {
  const t = weeklyThroughput(workItems(p, m), today, weeks);
  const samples = t.map(x => x.closed);
  const closedInHistory = samples.reduce((a, b) => a + b, 0);
  const active = samples.findIndex(s => s > 0);
  const weeksOfHistory = active === -1 ? 0 : samples.length - active;
  return { samples, weeksOfHistory, closedInHistory, thin: weeksOfHistory < 6 || closedInHistory < 10 };
}

export function releaseForecasts(p: Project, m: Mapping, today: string, inputs: ForecastInputs, seed = 7): ReleaseForecast[] {
  const groups = new Map<string, { title: string; due: string | null; items: Item[] }>();
  for (const i of workItems(p, m)) {
    const r = releaseOf(i, m);
    if (!r) continue;
    const id = m.release.kind === "milestone" ? `title:${r.title}` : r.id;
    if (!groups.has(id)) groups.set(id, { title: r.title, due: r.due, items: [] });
    const g = groups.get(id)!;
    if (r.due && (!g.due || r.due > g.due)) g.due = r.due;
    g.items.push(i);
  }
  const sorted = [...groups.entries()].sort((a, b) => (a[1].due ?? "9999").localeCompare(b[1].due ?? "9999"));
  let carried = 0;
  return sorted.map(([id, g]) => {
    const open = g.items.filter(i => i.state === "open").length;
    carried += open;
    const mc = monteCarloWeeks(carried, inputs.samples, { seed });
    const toDate = (w: number) => (Number.isFinite(w) ? addDays(mondayOf(today), w * 7 - 1) : null);
    const chance = mc && g.due ? (g.due < today && carried > 0 ? 0 : chanceWithin(mc, weeksUntil(today, g.due))) : null;
    return {
      id, title: g.title, due: g.due, total: g.items.length, open, cumulativeOpen: carried, mc, chance,
      p50Date: mc ? (mc.p50 === 0 ? today : toDate(mc.p50)) : null,
      p85Date: mc ? (mc.p85 === 0 ? today : toDate(mc.p85)) : null,
    };
  });
}
