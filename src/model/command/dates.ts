// Dates in words. "to the 15th", "next Friday", "end of the month" — the things people
// say when they are moving work around. Pure, and always relative to a day you name, so
// the same sentence means the same thing tomorrow.
import { addDays } from "../calendar";

export interface ParsedDate {
  /** The day, as an ISO day. */
  date: string;
  /** What the person said, for the label. */
  label: string;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const dayOf = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay();
const lastOfMonth = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
};

/**
 * The day a phrase names, if it names one. "the 15th" means the 15th of this month,
 * or of the next one if it has gone by.
 */
export function parseDate(phrase: string, today: string): ParsedDate | null {
  const text = phrase.toLowerCase().trim();
  if (!text) return null;

  if (/\btoday\b/.test(text)) return { date: today, label: "today" };
  if (/\btomorrow\b/.test(text)) return { date: addDays(today, 1), label: "tomorrow" };
  if (/\bday after tomorrow\b/.test(text)) return { date: addDays(today, 2), label: "the day after tomorrow" };
  if (/\bend of (the )?month\b/.test(text)) return { date: lastOfMonth(today), label: "the end of the month" };
  if (/\bstart of (the )?month\b/.test(text)) return { date: today.slice(0, 8) + "01", label: "the start of the month" };

  // "next Friday", "this Monday". The coming one, whichever day it is.
  const weekday = WEEKDAYS.findIndex(d => new RegExp(`\\b${d}\\b`).test(text));
  if (weekday >= 0) {
    const name = WEEKDAYS[weekday]!;
    const current = dayOf(today);
    let ahead = (weekday - current + 7) % 7;
    if (ahead === 0) ahead = 7;
    return { date: addDays(today, ahead), label: name };
  }

  // "the 15th", "15 March"
  const day = text.match(/\b(\d{1,2})(st|nd|rd|th)?\b/);
  const month = MONTHS.findIndex(m => new RegExp(`\\b${m}\\b`).test(text));
  if (month >= 0 && day) {
    const year = new Date(today + "T00:00:00Z").getUTCFullYear();
    return { date: `${year}-${String(month + 1).padStart(2, "0")}-${String(Number(day[1])).padStart(2, "0")}`, label: text };
  }
  if (day) {
    const d = Number(day[1]);
    if (d >= 1 && d <= 31) {
      const now = new Date(today + "T00:00:00Z");
      const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      // If the day has been, it means the same day next month.
      if (thisMonth >= today) return { date: thisMonth, label: `the ${d}th` };
      const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
      return { date: `${next.toISOString().slice(0, 7)}-${String(Math.min(d, last)).padStart(2, "0")}`, label: `the ${d}th` };
    }
  }
  return null;
}
