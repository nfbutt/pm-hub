// Per-browser cache of loaded projects, mappings and drafts (IndexedDB via idb-keyval).
// Failures are swallowed: the app works without a cache, just slower.
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";
import { defaultLocal, type LocalSettings } from "../ai/local";
import type { Project } from "../model/normalize";
import type { Mapping } from "../model/mapping";
import type { Draft } from "../model/schedule";
import type { ScenarioStore } from "../model/scenarios";

// IndexedDB can stall (a pending delete, a locked profile). The cache is optional, so every
// call gives up after a few seconds instead of leaving the app on a loading screen.
const TIMEOUT_MS = 3000;
export const UNAVAILABLE = Symbol("storage unavailable");
function timed<T>(p: Promise<T>): Promise<T | typeof UNAVAILABLE> {
  return Promise.race([p, new Promise<typeof UNAVAILABLE>(r => setTimeout(() => r(UNAVAILABLE), TIMEOUT_MS))]);
}
async function get<T>(key: string): Promise<T | undefined> { const v = await timed(idbGet<T>(key)); return v === UNAVAILABLE ? undefined : v; }
async function set(key: string, value: unknown): Promise<void> { await timed(idbSet(key, value)); }
async function del(key: string): Promise<void> { await timed(idbDel(key)); }

const projectKey = (owner: string, number: number) => `project:${owner}/${number}`;
const mappingKey = (owner: string, number: number) => `mapping:${owner}/${number}`;

export async function readCachedProject(owner: string, number: number): Promise<Project | null> {
  try { return (await get<Project>(projectKey(owner, number))) ?? null; } catch { return null; }
}
export async function writeCachedProject(p: Project) {
  try { await set(projectKey(p.owner, p.number), p); } catch { /* cache is optional */ }
}
export async function readMapping(owner: string, number: number): Promise<Mapping | null> {
  try { return (await get<Mapping>(mappingKey(owner, number))) ?? null; } catch { return null; }
}
export async function writeMapping(owner: string, number: number, m: Mapping) {
  try { await set(mappingKey(owner, number), m); } catch { /* optional */ }
}
const draftKey = (owner: string, number: number) => `draft:${owner}/${number}`;

export async function readDraft(owner: string, number: number): Promise<Draft | null> {
  try { return (await get<Draft>(draftKey(owner, number))) ?? null; } catch { return null; }
}
export async function writeDraft(owner: string, number: number, d: Draft) {
  try { await set(draftKey(owner, number), d); } catch { /* optional */ }
}
/** Removes the pm-hub v1 draft once it has been migrated into a scenario. */
export async function deleteLegacyDraft(owner: string, number: number) {
  try { await del(draftKey(owner, number)); } catch { /* optional */ }
}

const changesKey = (owner: string, number: number) => `changes:${owner}/${number}`;
/** Saved scenarios; null when there are none; UNAVAILABLE when storage didn't answer, so callers must not overwrite them. */
export async function readChanges(owner: string, number: number): Promise<ScenarioStore | null | typeof UNAVAILABLE> {
  try { const v = await timed(idbGet<ScenarioStore>(changesKey(owner, number))); return v === UNAVAILABLE ? UNAVAILABLE : v ?? null; } catch { return UNAVAILABLE; }
}
export async function writeChanges(owner: string, number: number, st: ScenarioStore) {
  try { await set(changesKey(owner, number), st); } catch { /* optional */ }
}

export async function forgetProject(owner: string, number: number) {
  try { await Promise.all([del(projectKey(owner, number)), del(mappingKey(owner, number)), del(draftKey(owner, number)), del(changesKey(owner, number))]); } catch { /* optional */ }
}

// Small per-browser view preferences.
export interface Prefs {
  zoom: "week" | "month" | "quarter"; fyStartMonth: number; includeClosed: boolean;
  /** What happens to dependents when a blocker's dates move. */
  shiftMode: "keep-gap" | "on-overlap" | "none";
  /** A model on this computer, for the Epic Map. Off unless asked for. */
  local: LocalSettings;
}
const PREFS = "pm-hub:prefs";
export const defaultPrefs: Prefs = { zoom: "month", fyStartMonth: 1, includeClosed: false, shiftMode: "on-overlap", local: defaultLocal };
export function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS) ?? "{}") as Partial<Prefs>;
    return { ...defaultPrefs, ...raw, local: { ...defaultPrefs.local, ...(raw.local ?? {}) } };
  } catch { return defaultPrefs; }
}
export function writePrefs(p: Prefs) {
  try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* optional */ }
}
