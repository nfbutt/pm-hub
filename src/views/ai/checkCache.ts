// What the last connection check found, and whether it is still worth believing.
// A check is only about the setup it was made on, and only for a while: a check that
// failed an hour ago says nothing about now, and a check of a different address says
// nothing about this one.
import type { LocalSettings, ModelCheck } from "../../ai/local";

const LAST_CHECK = "pm-hub:ai-check";

/** How long a check is worth believing. */
export const FRESH_MS = 5 * 60 * 1000;

export interface Cached { at: number; check: ModelCheck; about: string }

/** What the check was about, so a check of one setup is not read as a check of another. */
export function about(settings: LocalSettings): string {
  return `${settings.base}|${settings.chatModel}|${settings.embedModel}|${settings.allowRemote ? "hosted" : "local"}`;
}

/** The last check, if it is still true of this setup. */
export function readCheck(settings: LocalSettings, now = Date.now()): Cached | null {
  try {
    const c = JSON.parse(localStorage.getItem(LAST_CHECK) ?? "null") as Cached | null;
    if (!c || typeof c.at !== "number" || !c.check) return null;
    if (c.about !== about(settings)) return null;
    if (now - c.at > FRESH_MS) return null;
    return c;
  } catch { return null; }
}

/** Keeps the check, so the pill does not ask the model again on every page. */
export function writeCheck(check: ModelCheck, settings: LocalSettings, now = Date.now()): void {
  try { localStorage.setItem(LAST_CHECK, JSON.stringify({ at: now, check, about: about(settings) } satisfies Cached)); } catch { /* optional */ }
}
