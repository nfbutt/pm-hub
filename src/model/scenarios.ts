// Named change sets over the same GitHub snapshot ("Plan A", "Plan B"), each with its own
// undo history. Pure functions: the hook persists the result.
import type { Mapping } from "./mapping";
import type { Project } from "./normalize";
import { changeId, datesOp, type Change, type Op } from "./ops";
import { buildSchedule, type Draft } from "./schedule";

export interface Scenario {
  id: string;
  name: string;
  createdAt: string;
  /** Every recorded change, oldest first. Changes at index >= cursor are undone (redo-able). */
  changes: Change[];
  cursor: number;
}

export interface ScenarioStore { version: 1; active: string; scenarios: Scenario[] }

const now = () => new Date().toISOString();
const sid = () => `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export function newScenario(name: string, changes: Change[] = []): Scenario {
  return { id: sid(), name, createdAt: now(), changes, cursor: changes.length };
}

export function emptyStore(): ScenarioStore {
  const s = newScenario("Default");
  return { version: 1, active: s.id, scenarios: [s] };
}

export const activeScenario = (st: ScenarioStore): Scenario => st.scenarios.find(s => s.id === st.active) ?? st.scenarios[0]!;
export const activeChanges = (s: Scenario): Change[] => s.changes.slice(0, s.cursor);
export const activeOps = (s: Scenario): Op[] => activeChanges(s).flatMap(c => c.ops);

function updateActive(st: ScenarioStore, f: (s: Scenario) => Scenario): ScenarioStore {
  return { ...st, scenarios: st.scenarios.map(s => (s.id === st.active ? f(s) : s)) };
}

/** Adds a change, discarding anything that had been undone (like any editor). */
export function record(st: ScenarioStore, label: string, ops: Op[], reason?: string): ScenarioStore {
  if (!ops.length) return st;
  const change: Change = { id: changeId(), at: now(), label, ops, ...(reason ? { reason } : {}) };
  return updateActive(st, s => ({ ...s, changes: [...s.changes.slice(0, s.cursor), change], cursor: s.cursor + 1 }));
}

export const canUndo = (st: ScenarioStore) => activeScenario(st).cursor > 0;
export const canRedo = (st: ScenarioStore) => { const s = activeScenario(st); return s.cursor < s.changes.length; };
export const undo = (st: ScenarioStore) => (canUndo(st) ? updateActive(st, s => ({ ...s, cursor: s.cursor - 1 })) : st);
export const redo = (st: ScenarioStore) => (canRedo(st) ? updateActive(st, s => ({ ...s, cursor: s.cursor + 1 })) : st);

/** Removes every change touching these items from the active scenario (back to GitHub). */
export function discardItem(st: ScenarioStore, key: string): ScenarioStore {
  return updateActive(st, s => {
    const kept = activeChanges(s)
      .map(c => ({ ...c, ops: c.ops.filter(o => !("key" in o) || (o.key !== key && !(o.kind === "addBlockedBy" || o.kind === "removeBlockedBy" ? o.blocker === key : false))) }))
      .filter(c => c.ops.length);
    return { ...s, changes: kept, cursor: kept.length };
  });
}

export const clearActive = (st: ScenarioStore) => updateActive(st, s => ({ ...s, changes: [], cursor: 0 }));

export function addScenario(st: ScenarioStore, name: string, copyFrom?: string): ScenarioStore {
  const src = copyFrom ? st.scenarios.find(s => s.id === copyFrom) : undefined;
  const s = newScenario(name, src ? activeChanges(src).map(c => ({ ...c })) : []);
  return { ...st, active: s.id, scenarios: [...st.scenarios, s] };
}
export const renameScenario = (st: ScenarioStore, id: string, name: string) => ({ ...st, scenarios: st.scenarios.map(s => (s.id === id ? { ...s, name } : s)) });
export function removeScenario(st: ScenarioStore, id: string): ScenarioStore {
  const rest = st.scenarios.filter(s => s.id !== id);
  if (!rest.length) return emptyStore();
  return { ...st, scenarios: rest, active: st.active === id ? rest[0]!.id : st.active };
}
export const switchScenario = (st: ScenarioStore, id: string): ScenarioStore => (st.scenarios.some(s => s.id === id) ? { ...st, active: id } : st);

/** Converts a pm-hub v1 draft ({bars, order, parked}) into changes in a "Default" scenario. */
export function migrateLegacyDraft(draft: Draft, base: Project, m: Mapping): ScenarioStore {
  const byKey = new Map(base.items.map(i => [i.key, i]));
  const original = buildSchedule(base, m);
  const changes: Change[] = [];
  const at = now();
  for (const [key, bar] of Object.entries(draft.bars)) {
    const item = byKey.get(key);
    if (!item) continue;
    const o = original.bars.get(key);
    if (o && o.start === bar.start && o.end === bar.end) continue;
    changes.push({ id: changeId(), at, label: "Dates (from the v1 draft)", ops: [datesOp(item, m, bar.start, bar.end)] });
  }
  for (const [lane, order] of Object.entries(draft.order)) changes.push({ id: changeId(), at, label: `Order of ${lane} (from the v1 draft)`, ops: [{ kind: "reorder", lane, before: [], after: order }] });
  for (const key of draft.parked) if (byKey.has(key)) changes.push({ id: changeId(), at, label: "Parked (from the v1 draft)", ops: [{ kind: "park", key, before: false, after: true }] });
  const s = newScenario("Default", changes);
  return { version: 1, active: s.id, scenarios: [s] };
}
