// Header segments and x-positions for a time window. Pure: no DOM.
import { addDays } from "./mapping";
import { daysBetween } from "./schedule";

export type Zoom = "week" | "month" | "quarter";
export const DAY_PX: Record<Zoom, number> = { week: 16, month: 5, quarter: 2 };
/** Drag snapping in days. */
export const SNAP_DAYS: Record<Zoom, number> = { week: 1, month: 7, quarter: 7 };

export interface Segment { label: string; start: string; days: number }

const parse = (d: string) => new Date(d + "T00:00:00Z");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** fyStartMonth is 1-12; 1 = calendar year, 10 = US federal fiscal year (FY starts Oct 1). */
export function quarterLabel(date: string, fyStartMonth: number): string {
  const d = parse(date), m = d.getUTCMonth(), y = d.getUTCFullYear();
  const shifted = (m - (fyStartMonth - 1) + 12) % 12;
  const q = Math.floor(shifted / 3) + 1;
  if (fyStartMonth === 1) return `${y} Q${q}`;
  const fy = m >= fyStartMonth - 1 ? y + 1 : y;
  return `FY${String(fy).slice(2)} Q${q}`;
}

function segments(start: string, end: string, keyOf: (d: string) => string, labelOf: (d: string) => string): Segment[] {
  const out: Segment[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const k = keyOf(d);
    const last = out[out.length - 1];
    if (last && (last as Segment & { k?: string }).k === k) last.days++;
    else out.push(Object.assign({ label: labelOf(d), start: d, days: 1 }, { k }));
  }
  return out.map(({ label, start, days }) => ({ label, start, days }));
}

export function axis(start: string, end: string, fyStartMonth: number) {
  const quarters = segments(start, end, d => quarterLabel(d, fyStartMonth), d => quarterLabel(d, fyStartMonth));
  const months = segments(start, end, d => d.slice(0, 7), d => { const x = parse(d); return `${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`; });
  const weeks: Segment[] = [];
  for (let d = start; d <= end; d = addDays(d, 7)) weeks.push({ label: String(parse(d).getUTCDate()), start: d, days: Math.min(7, daysBetween(d, end) + 1) });
  return { quarters, months, weeks, days: daysBetween(start, end) + 1 };
}

export const xOf = (windowStart: string, date: string, dayPx: number) => daysBetween(windowStart, date) * dayPx;
