// Working days. A plan that runs through a weekend is wrong in a way every reviewer
// spots, and it quietly lengthens the chain that decides the end date, so the schedule
// counts days you can actually work in.
import type { Mapping } from "./mapping";

/** 0 is Sunday. */
export const WEEKDAYS = [1, 2, 3, 4, 5];

/** The days a project works, with the days the project has off. */
export interface Calendar {
  /** Which days of the week are working days: 0 is Sunday. */
  workingDays: number[];
  /** The days that are not working days, whatever the week says. */
  holidays: string[];
}

export const defaultCalendar: Calendar = { workingDays: WEEKDAYS, holidays: [] };

/** The project's calendar, falling back for mappings saved before it existed. */
export function calendarOf(mapping: Mapping): Calendar {
  const days = mapping.workingDays?.length ? mapping.workingDays : WEEKDAYS;
  return { workingDays: days, holidays: mapping.holidays ?? [] };
}

const dayOf = (date: string) => new Date(date + "T00:00:00Z").getUTCDay();

/** Can work be done on this day? */
export function isWorkingDay(date: string, cal: Calendar): boolean {
  if (cal.holidays.includes(date)) return false;
  return cal.workingDays.includes(dayOf(date));
}

/** The first working day on or after this one. */
export function nextWorkingDay(date: string, cal: Calendar): string {
  let d = date;
  for (let i = 0; i < 30 && !isWorkingDay(d, cal); i++) d = addDays(d, 1);
  return d;
}

/** The last working day on or before this one. */
export function previousWorkingDay(date: string, cal: Calendar): string {
  let d = date;
  for (let i = 0; i < 30 && !isWorkingDay(d, cal); i++) d = addDays(d, -1);
  return d;
}

/** The day that is `days` working days after this one. Negative counts go back. */
export function addWorkingDays(date: string, days: number, cal: Calendar): string {
  if (days === 0) return date;
  let d = days > 0 ? nextWorkingDay(date, cal) : previousWorkingDay(date, cal);
  let left = Math.abs(days);
  const step = days > 0 ? 1 : -1;
  while (left > 0) { d = addDays(d, step); if (isWorkingDay(d, cal)) left--; }
  return d;
}

/** How many working days there are between two days, counting the first and not the last. */
export function workingDaysBetween(from: string, to: string, cal: Calendar): number {
  if (to <= from) return 0;
  let n = 0;
  for (let d = from; d < to; d = addDays(d, 1)) if (isWorkingDay(d, cal)) n++;
  return n;
}

/** The days between two days. */
export function addDays(day: string, days: number): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
