// Rolling a change back after it reached GitHub: the operations that put it back, the
// record that makes it possible days later, and the review that groups a bulk change
// into one row.
import { describe, expect, it } from "vitest";
import { applyOps, foldOps, inverseOps, netOps, remapKeys, slotOf, type Change, type Op } from "../src/model/ops";
import { rollbackNote, rollbackOps, summariseRollback } from "../src/model/rollback";
import { checkStep } from "../src/github/apply";
import { activeChanges, canUndo, discardItem, discardOps, emptyStore, record, removeSlots, undo } from "../src/model/scenarios";
import { normalizeProject, type Item } from "../src/model/normalize";

const META = {
  id: "PVT", number: 1, title: "T", url: "", shortDescription: null, closed: false, updatedAt: "2026-01-01T00:00:00Z",
  items: { totalCount: 1 }, fields: { nodes: [] },
};
const RAW_ITEM = {
  id: "item-1", type: "ISSUE", isArchived: false, fieldValues: { nodes: [] },
  content: {
    __typename: "Issue", id: "I_12", number: 12, title: "Created epic", body: "", url: "https://example.com/1",
    state: "OPEN", stateReason: null, createdAt: "2026-01-01T00:00:00Z", closedAt: null, updatedAt: "2026-01-01T00:00:00Z",
    repository: { nameWithOwner: "o/r" }, labels: { nodes: [] }, assignees: { nodes: [] }, milestone: null, issueType: null,
    parent: null, subIssuesSummary: { total: 0, completed: 0 }, blockedBy: { nodes: [] },
  },
};

const create = (key: string, title: string): Extract<Op, { kind: "create" }> => ({
  kind: "create", key, item: { title, repo: "o/r", parentKey: null, labels: [], fields: {} },
});

describe("undoing what was applied", () => {
  it("closes a created issue and takes it out of the project", () => {
    // GitHub cannot undo a creation, so the issue is closed as well.
    const ops = inverseOps([create("new:x", "New epic")]);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ kind: "setState", key: "new:x", after: { state: "closed", reason: "NOT_PLANNED" } });
    expect(ops[1]).toMatchObject({ kind: "archive", key: "new:x" });
  });

  it("undoes the last change first", () => {
    const ops = inverseOps([
      { kind: "setTitle", key: "o/r#1", before: "A", after: "B" },
      { kind: "setTitle", key: "o/r#2", before: "C", after: "D" },
    ]);
    expect(ops.map(o => ("key" in o ? o.key : ""))).toEqual(["o/r#2", "o/r#1"]);
    // The inverse swaps the two values: what GitHub has now, and what it had before.
    expect(ops[0]).toMatchObject({ before: "D", after: "C" });
  });

  it("puts a created item back under its own key", () => {
    const ops = rollbackOps({ ops: [create("new:x", "New epic")], keys: { "new:x": "o/r#12" } });
    expect(ops.every(o => "key" in o && o.key === "o/r#12")).toBe(true);
  });

  it("carries the id of an item that was taken out of the project", () => {
    // An archived item is not in the project any more, so its id has to travel with it.
    const ops = rollbackOps({
      ops: [{ kind: "archive", key: "o/r#7" }],
      ids: { "o/r#7": { item: "PVTI_7", content: "I_7" } },
    });
    expect(ops[0]).toMatchObject({ kind: "unarchive", key: "o/r#7", itemId: "PVTI_7" });
  });

  it("says what it will do, and that the issues stay closed", () => {
    const ops = rollbackOps({ ops: [create("new:x", "One"), create("new:y", "Two")] });
    const summary = summariseRollback(ops);
    expect(summary.closed).toBe(2);
    expect(summary.ops).toBe(4);
    expect(rollbackNote(summary)).toContain("stay in the repository, closed");
    expect(rollbackNote({ closed: 0, restored: 0, restoredOps: 3, ops: 3 })).toBeNull();
  });

  it("survives being written to the history and read back", () => {
    const applied = { ops: [create("new:x", "New epic"), { kind: "setTitle", key: "o/r#1", before: "A", after: "B" } as Op] };
    const saved = JSON.parse(JSON.stringify(applied));
    const ops = rollbackOps(saved);
    expect(ops).toHaveLength(3);
    expect(ops[0]).toMatchObject({ kind: "setTitle", before: "B", after: "A" });
  });
});

describe("the review groups a bulk change into one row", () => {
  const change = (label: string, ops: Op[]): Change => ({ id: label, at: "2026-01-01T00:00:00Z", label, ops });

  it("keeps the net ops exactly as before", () => {
    const ops: Op[] = [
      { kind: "setTitle", key: "o/r#1", before: "A", after: "B" },
      { kind: "setTitle", key: "o/r#1", before: "B", after: "C" },
      { kind: "setParent", key: "o/r#2", before: null, after: "o/r#1" },
    ];
    const folded = foldOps(ops.map(op => ({ change: null, op })));
    expect(folded.map(f => f.op)).toEqual(netOps(ops));
  });

  it("says which change each op came from", () => {
    const a = change("First", [{ kind: "setTitle", key: "o/r#1", before: "A", after: "B" }]);
    const b = change("Second", [{ kind: "setTitle", key: "o/r#2", before: "C", after: "D" }]);
    const folded = foldOps([...a.ops, ...b.ops].map(op => ({ change: op === a.ops[0] ? a : b, op })));
    expect(folded.map(f => f.change?.label)).toEqual(["First", "Second"]);
  });

  it("folds repeated edits across changes into one op", () => {
    const a = change("First", [{ kind: "setTitle", key: "o/r#1", before: "A", after: "B" }]);
    const b = change("Second", [{ kind: "setTitle", key: "o/r#1", before: "B", after: "C" }]);
    const folded = foldOps([...a.ops, ...b.ops].map(op => ({ change: op === a.ops[0] ? a : b, op })));
    expect(folded).toHaveLength(1);
    // The first "before" is kept, so the conflict check still knows what GitHub had.
    expect(folded[0]!.op).toMatchObject({ before: "A", after: "C" });
  });
});

describe("discarding a change", () => {
  it("keeps the operations so they can be put back", () => {
    const store = record(emptyStore(), "Moved a thing", [{ kind: "setTitle", key: "o/r#1", before: "A", after: "B" }]);
    const scenario = store.scenarios[0]!;
    const removed = discardOps(scenario, "o/r#1");
    expect(removed).toHaveLength(1);
    const after = discardItem(store, "o/r#1");
    expect(after.scenarios[0]!.changes).toHaveLength(0);
  });

  it("does not take the operations of other items with it", () => {
    const store = record(emptyStore(), "Two things", [
      { kind: "setTitle", key: "o/r#1", before: "A", after: "B" },
      { kind: "setTitle", key: "o/r#2", before: "C", after: "D" },
    ]);
    expect(discardOps(store.scenarios[0]!, "o/r#1")).toHaveLength(1);
    expect(discardItem(store, "o/r#1").scenarios[0]!.changes[0]!.ops).toHaveLength(1);
  });
});

describe("after an apply", () => {
  it("drops the operations that point at an item the apply created", () => {
    // The item now has a real GitHub key, so an operation on the draft key could never
    // be applied: it goes with the create.
    const store = record(emptyStore(), "A new epic", [
      create("new:x", "New epic"),
      { kind: "setParent", key: "new:x", before: null, after: "o/r#9" },
    ]);
    const after = removeSlots(store, new Set([slotOf(create("new:x", "New epic"))]));
    expect(after.scenarios[0]!.changes).toHaveLength(0);
  });

  it("keeps the operations of the items that were not applied", () => {
    const store = record(emptyStore(), "A new epic", [
      create("new:x", "New epic"),
      { kind: "setTitle", key: "o/r#1", before: "A", after: "B" },
    ]);
    const after = removeSlots(store, new Set(["create:new:x"]));
    expect(after.scenarios[0]!.changes[0]!.ops).toHaveLength(1);
  });
});

describe("a rollback is an ordinary change", () => {
  it("undoes in one step", () => {
    const ops = rollbackOps({ ops: [create("new:x", "One"), create("new:y", "Two")] });
    const store = record(emptyStore(), "Roll back the change", ops);
    expect(canUndo(store)).toBe(true);
    expect(activeChanges(store.scenarios[0]!)).toHaveLength(1);
    const undone = undo(store);
    expect(activeChanges(undone.scenarios[0]!)).toHaveLength(0);
  });

  it("applies to the draft as a change", () => {
    // The item a rollback closes is one the apply created; in the draft it is gone, so
    // the rollback is what puts the plan back.
    const ops = rollbackOps({ ops: [create("new:x", "One")], keys: { "new:x": "o/r#12" } });
    const base = normalizeProject("o", META, [RAW_ITEM] as never, "2026-01-01T00:00:00Z");
    const applied = applyOps(base, ops);
    expect(applied.project.items.find(i => i.key === "o/r#12")).toBeUndefined();
  });
});

describe("checking a rollback against GitHub", () => {
  it("accepts restoring an item that is only out of the project", () => {
    const op: Op = { kind: "unarchive", key: "o/r#7", itemId: "PVTI_7" };
    expect(checkStep(op, undefined).status).toBe("ready");
  });

  it("flags an archive of something already archived as done", () => {
    const op: Op = { kind: "archive", key: "o/r#7" };
    expect(checkStep(op, { key: "o/r#7", archived: true } as Item).status).toBe("already");
  });
});

describe("remapping keys", () => {
  it("moves a new item's parent when the parent is new too", () => {
    const op = create("new:child", "Child");
    const withParent: Op = { ...op, item: { ...op.item, parentKey: "new:parent" } };
    const out = remapKeys(withParent, new Map([["new:child", "o/r#2"], ["new:parent", "o/r#1"]]));
    expect(out.kind).toBe("create");
    if (out.kind === "create") expect(out.item.parentKey).toBe("o/r#1");
  });
});
