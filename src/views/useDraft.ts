import { useCallback, useEffect, useState } from "react";
import { emptyDraft, type Draft } from "../model/schedule";
import { readDraft, writeDraft } from "../store/cache";

/** The local, never-pushed draft for one project, persisted in this browser. */
export function useDraft(owner: string, number: number) {
  const [draft, setDraftState] = useState<Draft>(emptyDraft);
  useEffect(() => {
    let live = true;
    readDraft(owner, number).then(d => { if (live && d) setDraftState({ ...emptyDraft(), ...d }); });
    return () => { live = false; };
  }, [owner, number]);
  const setDraft = useCallback((update: (d: Draft) => Draft) => {
    setDraftState(prev => { const next = update(prev); void writeDraft(owner, number, next); return next; });
  }, [owner, number]);
  const resetDraft = useCallback(() => setDraft(() => emptyDraft()), [setDraft]);
  const changed = Object.keys(draft.bars).length + draft.parked.length + Object.keys(draft.order).length;
  return { draft, setDraft, resetDraft, changed };
}
