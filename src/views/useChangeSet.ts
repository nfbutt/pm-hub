import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Mapping } from "../model/mapping";
import type { Project } from "../model/normalize";
import { applyOps, describe, netOps, type Applied, type Op } from "../model/ops";
import {
  activeOps, activeScenario, addScenario, canRedo, canUndo, clearActive, discardItem, emptyStore, migrateLegacyDraft,
  record, redo, removeScenario, removeSlots, renameScenario, switchScenario, undo, type ScenarioStore,
} from "../model/scenarios";
import { deleteLegacyDraft, readChanges, readDraft, UNAVAILABLE, writeChanges } from "../store/cache";

/** What views get to make edits. Every edit is a recorded op; nothing is written to GitHub here. */
export interface Editor {
  /** The project as GitHub has it. */
  base: Project;
  /** Records one user action (several ops undo together). */
  record: (label: string, ops: Op[]) => void;
  /** Drops every change to one item. */
  discard: (key: string) => void;
  titleOf: (key: string) => string;
}

export interface ChangeSetState {
  ready: boolean;
  /** False when browser storage didn't answer: edits still work but won't survive closing the tab. */
  persistent: boolean;
  store: ScenarioStore;
  applied: Applied | null;
  /** Net changes after folding repeated edits. */
  net: Op[];
  editor: Editor | null;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
  clear: () => void;
  /** After an apply: drops changes to these slots from the active scenario. */
  removeSlots: (slots: Set<string>) => void;
  scenarios: {
    list: { id: string; name: string; count: number }[];
    active: string;
    switchTo: (id: string) => void; add: (name: string, copy: boolean) => void; rename: (id: string, name: string) => void; remove: (id: string) => void;
  };
  /** The last action, for the undo toast. */
  lastAction: { label: string; at: number } | null;
}

export function useChangeSet(owner: string, number: number, base: Project | null, mapping: Mapping | null): ChangeSetState {
  const [store, setStore] = useState<ScenarioStore>(emptyStore);
  const [ready, setReady] = useState(false);
  const [lastAction, setLastAction] = useState<{ label: string; at: number } | null>(null);
  const loaded = useRef(false);
  const persist = useRef(true);
  const [persistent, setPersistent] = useState(true);

  // Load once the project is known, migrating a v1 draft the first time.
  useEffect(() => {
    if (!base || !mapping || loaded.current) return;
    loaded.current = true;
    (async () => {
      const saved = await readChanges(owner, number);
      if (saved === UNAVAILABLE) { persist.current = false; setPersistent(false); setReady(true); return; }
      if (saved) { setStore(saved); setReady(true); return; }
      const legacy = await readDraft(owner, number);
      if (legacy && (Object.keys(legacy.bars).length || legacy.parked.length || Object.keys(legacy.order).length)) {
        const migrated = migrateLegacyDraft(legacy, base, mapping);
        setStore(migrated);
        await writeChanges(owner, number, migrated);
        await deleteLegacyDraft(owner, number);
      }
      setReady(true);
    })();
  }, [owner, number, base, mapping]);

  const update = useCallback((f: (s: ScenarioStore) => ScenarioStore) => {
    setStore(prev => { const next = f(prev); if (next !== prev && persist.current) void writeChanges(owner, number, next); return next; });
  }, [owner, number]);

  const scenario = activeScenario(store);
  const ops = useMemo(() => activeOps(scenario), [scenario]);
  const applied = useMemo(() => (base ? applyOps(base, ops) : null), [base, ops]);
  const net = useMemo(() => netOps(ops), [ops]);

  const titleOf = useCallback((key: string) => applied?.project.items.find(i => i.key === key)?.title ?? base?.items.find(i => i.key === key)?.title ?? key, [applied, base]);

  const editor = useMemo<Editor | null>(() => (base ? {
    base,
    record: (label, newOps) => { if (!newOps.length) return; update(s => record(s, label, newOps)); setLastAction({ label, at: Date.now() }); },
    discard: key => { update(s => discardItem(s, key)); setLastAction({ label: `Reverted ${titleOf(key)} to GitHub`, at: Date.now() }); },
    titleOf,
  } : null), [base, update, titleOf]);

  return {
    ready, persistent, store, applied, net, editor,
    undo: () => { if (canUndo(store)) { const c = scenario.changes[scenario.cursor - 1]; update(undo); setLastAction(c ? { label: `Undid: ${c.label}`, at: Date.now() } : null); } },
    redo: () => { if (canRedo(store)) { const c = scenario.changes[scenario.cursor]; update(redo); setLastAction(c ? { label: `Redid: ${c.label}`, at: Date.now() } : null); } },
    canUndo: canUndo(store), canRedo: canRedo(store),
    clear: () => update(clearActive),
    removeSlots: slots => update(s => removeSlots(s, slots)),
    scenarios: {
      list: store.scenarios.map(s => ({ id: s.id, name: s.name, count: netOps(activeOps(s)).length })),
      active: store.active,
      switchTo: id => update(s => switchScenario(s, id)),
      add: (name, copy) => update(s => addScenario(s, name, copy ? s.active : undefined)),
      rename: (id, name) => update(s => renameScenario(s, id, name)),
      remove: id => update(s => removeScenario(s, id)),
    },
    lastAction,
  };
}

export { describe as describeOp };
