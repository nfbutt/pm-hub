// Remembering which Epic Map suggestions you turned down, so the map stops asking.
// Kept in IndexedDB with the rest of the per-browser state. Failures are swallowed:
// a full disk should not stop the map from working.
import { get as idbGet, set as idbSet } from "idb-keyval";
import type { SuggestionMemory } from "../model/epicmap/suggest";

/** How long a snoozed suggestion stays hidden. */
export const SNOOZE_DAYS = 7;

const memoryKey = (owner: string, number: number) => `emap-rejected:${owner}/${number}`;

/** What you said about each suggestion so far. */
export async function readSuggestionMemory(owner: string, number: number): Promise<SuggestionMemory> {
  try { return (await idbGet<SuggestionMemory>(memoryKey(owner, number))) ?? {}; } catch { return {}; }
}

export async function writeSuggestionMemory(owner: string, number: number, memory: SuggestionMemory) {
  try { await idbSet(memoryKey(owner, number), memory); } catch { /* optional */ }
}

/** "No thanks", forever. */
export async function rejectSuggestion(owner: string, number: number, id: string) {
  const memory = await readSuggestionMemory(owner, number);
  memory[id] = "rejected";
  await writeSuggestionMemory(owner, number, memory);
}

/** "Not now": the suggestion comes back after a week. */
export async function snoozeSuggestion(owner: string, number: number, id: string, days = SNOOZE_DAYS) {
  const memory = await readSuggestionMemory(owner, number);
  memory[id] = { snoozedUntil: new Date(Date.now() + days * 86400000).toISOString() };
  await writeSuggestionMemory(owner, number, memory);
}

/** Takes back a rejection, so the suggestion is offered again. */
export async function undoSuggestion(owner: string, number: number, id: string) {
  const memory = await readSuggestionMemory(owner, number);
  delete memory[id];
  await writeSuggestionMemory(owner, number, memory);
}
