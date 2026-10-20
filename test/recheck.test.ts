// The last-second check: nothing is written over a change made while the review screen
// was open. This is the gap that the research calls a check-to-apply race, and it is the
// one place where pm-hub's re-read gate has to be exact.
import { describe, expect, it } from "vitest";
import { recheck, type Step } from "../src/github/apply";
import type { Item } from "../src/model/normalize";

const item = (over: Partial<Item> = {}): Item => ({
  key: "o/r#1", title: "An epic", state: "open", labels: [], assignees: [], fields: {}, blockedBy: [],
  id: "PVTI_1", kind: "issue", number: 1, repo: "o/r", url: null, stateReason: null, createdAt: null,
  closedAt: null, updatedAt: null, milestone: null, issueType: null, parentKey: null, subIssues: null,
  archived: false, ids: { content: null, repo: null, parent: null, labels: {}, assignees: {} },
  ...over,
});

const step = (op: Step["op"], status: Step["status"] = "ready"): Step => ({
  id: `s-${status}`, op, label: "a change", include: true, status,
});

describe("checking again just before writing", () => {
  it("leaves a change alone when GitHub still has what it expects", () => {
    const op = { kind: "setTitle", key: "o/r#1", before: "Old", after: "New" } as const;
    const { steps, changed } = recheck([step(op)], new Map([["o/r#1", item({ title: "Old" })]]));
    expect(changed).toBe(0);
    expect(steps[0]!.status).toBe("ready");
  });

  it("turns a change into a conflict when someone else has touched the item", () => {
    const op = { kind: "setTitle", key: "o/r#1", before: "Old", after: "New" } as const;
    const { steps, changed } = recheck([step(op)], new Map([["o/r#1", item({ title: "Someone else's" })]]));
    expect(changed).toBe(1);
    expect(steps[0]!.status).toBe("conflict");
    // It is left out rather than written over.
    expect(steps[0]!.include).toBe(false);
    expect(steps[0]!.message).toContain("Someone else's");
  });

  it("leaves the steps that were already conflicts alone", () => {
    const op = { kind: "setTitle", key: "o/r#1", before: "Old", after: "New" } as const;
    const { steps, changed } = recheck([step(op, "conflict")], new Map([["o/r#1", item({ title: "New" })]]));
    expect(changed).toBe(0);
    expect(steps[0]!.status).toBe("conflict");
  });

  it("does not touch the steps that are only in pm-hub", () => {
    const op = { kind: "park", key: "o/r#1", before: false, after: true } as const;
    const { steps, changed } = recheck([step(op, "local")], new Map());
    expect(changed).toBe(0);
    expect(steps[0]!.status).toBe("local");
  });

  it("catches a change to a field, not just a title", () => {
    const op = { kind: "setField", key: "o/r#1", field: "Status", before: { kind: "single", name: "Todo", optionId: "1" }, after: { kind: "single", name: "Done", optionId: "2" } } as const;
    const { changed } = recheck([step(op)], new Map([["o/r#1", item({ fields: { Status: { kind: "single", name: "In Progress", optionId: "3" } } })]]));
    expect(changed).toBe(1);
  });
});
