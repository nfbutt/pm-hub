// Per-browser cache of loaded projects, mappings and drafts (IndexedDB via idb-keyval).
// Failures are swallowed: the app works without a cache, just slower.
import { del, get, set } from "idb-keyval";
import type { Project } from "../model/normalize";
import type { Mapping } from "../model/mapping";
import type { Draft } from "../model/schedule";
import type { ScenarioStore } from "../model/scenarios";

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
export async function readChanges(owner: string, number: number): Promise<ScenarioStore | null> {
  try { return (await get<ScenarioStore>(changesKey(owner, number))) ?? null; } catch { return null; }
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
}
const PREFS = "pm-hub:prefs";
export const defaultPrefs: Prefs = { zoom: "month", fyStartMonth: 1, includeClosed: false, shiftMode: "on-overlap" };
export function readPrefs(): Prefs {
  try { return { ...defaultPrefs, ...JSON.parse(localStorage.getItem(PREFS) ?? "{}") }; } catch { return defaultPrefs; }
}
export function writePrefs(p: Prefs) {
  try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* optional */ }
}
