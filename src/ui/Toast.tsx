import { useEffect, useState } from "react";

/** A bottom-corner notice for the last action, with Undo. Hides itself after a few seconds. */
export function UndoToast({ action, onUndo, canUndo }: { action: { label: string; at: number } | null; onUndo: () => void; canUndo: boolean }) {
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!action) return;
    setShown(action.at);
    const t = setTimeout(() => setShown(s => (s === action.at ? null : s)), 6000);
    return () => clearTimeout(t);
  }, [action]);
  if (!action || shown !== action.at) return null;
  const isUndo = action.label.startsWith("Undid") || action.label.startsWith("Redid");
  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{action.label}</span>
      {canUndo && !isUndo && <button className="btn" onClick={onUndo}>Undo <kbd>Ctrl Z</kbd></button>}
      <button className="x" aria-label="Dismiss" onClick={() => setShown(null)}>×</button>
    </div>
  );
}
