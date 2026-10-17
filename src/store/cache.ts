// Per-browser cache of loaded projects, mappings and drafts (IndexedDB via idb-keyval).
// Failures are swallowed: the app works without a cache, just slower.
import { del, get, set } from "idb-keyval";
import type { Project } from "../model/normalize";
import type { Mapping } from "../model/mapping";

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
export async function forgetProject(owner: string, number: number) {
  try { await Promise.all([del(projectKey(owner, number)), del(mappingKey(owner, number))]); } catch { /* optional */ }
}
