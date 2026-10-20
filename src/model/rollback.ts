// Rolling a change back after it has already reached GitHub.
//
// GitHub has no undo and no time travel, so pm-hub keeps its own record of what it
// applied: the operations, the items it created, and the ids it touched. From that it
// can rebuild the operations that would put things back.
//
// One thing GitHub cannot do is undo a creation. The issue stays in the repository, so a
// rollback closes it and takes it out of the project, and says so. Pure.
import { inverseOps, remapKeys, type Op } from "./ops";

/** What pm-hub remembers about an apply, so it can be undone later. */
export interface AppliedChange {
  /** The operations that were applied. */
  ops: Op[];
  /** Draft key -> the GitHub key, for the items the apply created. */
  keys?: Record<string, string>;
  /** Item key -> the ids GitHub uses, so an archived item can still be addressed. */
  ids?: Record<string, { item: string; content: string }>;
}

export interface RollbackSummary {
  /** Items that will be closed and taken out of the project. */
  closed: number;
  /** Items that will be put back into the project. */
  restored: number;
  /** Everything else that will be put back the way it was. */
  restoredOps: number;
  ops: number;
}

/**
 * The operations that would undo an apply, last change first. A created item is closed
 * and taken out of the project; everything else is put back the way it was.
 */
export function rollbackOps(applied: AppliedChange): Op[] {
  const keyMap = new Map(Object.entries(applied.keys ?? {}));
  const ids = applied.ids ?? {};
  return inverseOps(applied.ops).map(op => {
    const mapped = remapKeys(op, keyMap);
    // An item that was taken out of the project is not in the project any more, so the
    // rollback carries the id GitHub knows it by.
    if (mapped.kind === "archive" || mapped.kind === "unarchive") {
      const id = ids[mapped.key];
      return id ? { ...mapped, itemId: id.item } : mapped;
    }
    return mapped;
  });
}

/** What the rollback will do, for the line the user reads before agreeing to it. */
export function summariseRollback(ops: Op[]): RollbackSummary {
  let closed = 0, restored = 0, restoredOps = 0;
  for (const op of ops) {
    if (op.kind === "archive") closed++;
    else if (op.kind === "unarchive") restored++;
    else restoredOps++;
  }
  return { closed, restored, restoredOps, ops: ops.length };
}

/** The sentence that explains what a rollback does to the issues it created. */
export function rollbackNote(summary: RollbackSummary): string | null {
  if (!summary.closed) return null;
  return summary.closed === 1
    ? "GitHub cannot undo a creation, so the issue this created is closed and taken out of the project. It stays in the repository, closed."
    : `GitHub cannot undo a creation, so the ${summary.closed} issues this created are closed and taken out of the project. They stay in the repository, closed.`;
}
