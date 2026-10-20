// A proposal: changes someone has put up rather than applied, and how a colleague picks
// one up.
import { describe, expect, it } from "vitest";
import { describeProposal, isUseful, type Proposal } from "../src/model/proposal";
import { applyOps } from "../src/model/ops";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { normalizeProject } from "../src/model/normalize";
import { detectMapping } from "../src/model/mapping";
import { newItem } from "../src/model/edits";

const f = makeFixture("2026-10-19");
const project = normalizeProject(DEMO_OWNER, f.meta, f.items, "2026-10-19T12:00:00Z");
const mapping = detectMapping(project);

const proposal = (ops: Proposal["ops"]): Proposal => ({
  version: 1, at: "2026-10-20T09:00:00Z", author: "ana", name: "A new epic", note: "It should exist", ops,
});

describe("proposals", () => {
  it("is only worth showing if it changes something", () => {
    expect(isUseful(proposal([]))).toBe(false);
    expect(isUseful(proposal([{ kind: "park", key: "o/r#1", before: false, after: true }]))).toBe(true);
  });

  it("says what it does, in words", () => {
    const ops = newItem(project, mapping, "A new epic", { epic: true });
    const described = describeProposal(proposal(ops), k => project.items.find(i => i.key === k)?.title ?? k);
    expect(described).toContain("1 new");
  });

  it("picks up exactly what was put up", () => {
    // A proposal is the operations, so what a colleague gets is what was drafted.
    const ops = newItem(project, mapping, "A new epic", { epic: true });
    const applied = applyOps(project, proposal(ops).ops);
    expect(applied.project.items.some(i => i.title === "A new epic")).toBe(true);
  });

  it("survives being written down and read back", () => {
    const p = proposal(newItem(project, mapping, "A new epic", { epic: true }));
    const back = JSON.parse(JSON.stringify(p)) as Proposal;
    expect(back.ops).toEqual(p.ops);
    expect(back.name).toBe("A new epic");
  });
});
