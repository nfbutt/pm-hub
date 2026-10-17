import { describe, expect, it } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { normalizeProject } from "../src/model/normalize";

const ANCHOR = "2026-10-19";
const f = makeFixture(ANCHOR);
const p = normalizeProject(DEMO_OWNER, f.meta, f.items, "2026-10-19T12:00:00Z");

describe("normalizeProject", () => {
  it("drops archived items and keeps everything else", () => {
    expect(f.items.some(i => i.isArchived)).toBe(true);
    expect(p.items).toHaveLength(f.items.length - 1);
  });

  it("is deterministic for the same anchor", () => {
    const again = normalizeProject(DEMO_OWNER, makeFixture(ANCHOR).meta, makeFixture(ANCHOR).items, p.loadedAt);
    expect(again).toEqual(p);
  });

  it("builds stable keys and parent links", () => {
    const story = p.items.find(i => i.parentKey)!;
    expect(story.key).toMatch(/^demo-co\/orbit(-api)?#\d+$/);
    expect(p.items.some(i => i.key === story.parentKey)).toBe(true);
  });

  it("reads every field value type it asked for", () => {
    const epic = p.items.find(i => i.issueType === "Epic")!;
    expect(epic.fields["Start date"]).toEqual({ kind: "date", date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(epic.fields["Priority"]?.kind).toBe("single");
    const story = p.items.find(i => i.fields["Sprint"])!;
    expect(story.fields["Sprint"]).toMatchObject({ kind: "iteration", duration: 14 });
  });

  it("maps drafts, PRs and blocked-by references", () => {
    expect(p.items.find(i => i.kind === "draft")?.title).toBe("Explore SSO for enterprise tier");
    expect(p.items.find(i => i.kind === "pr")?.state).toBe("merged");
    const blocked = p.items.filter(i => i.blockedBy.length);
    expect(blocked.length).toBeGreaterThan(3);
    for (const b of blocked) for (const ref of b.blockedBy) expect(p.items.some(i => i.key === ref.key)).toBe(true);
  });

  it("orders iterations by start date and marks completed ones", () => {
    const sprint = p.fields.find(x => x.kind === "iteration");
    expect(sprint?.kind).toBe("iteration");
    if (sprint?.kind !== "iteration") return;
    const starts = sprint.iterations.map(i => i.startDate);
    expect([...starts].sort()).toEqual(starts);
    expect(sprint.iterations.some(i => i.completed)).toBe(true);
    expect(sprint.iterations.some(i => !i.completed)).toBe(true);
  });

  it("keeps sub-issue summaries only when there are sub-issues", () => {
    const epics = p.items.filter(i => i.issueType === "Epic");
    expect(epics.every(e => e.subIssues && e.subIssues.total >= 5)).toBe(true);
    expect(p.items.filter(i => i.issueType === "Task").every(t => t.subIssues === null)).toBe(true);
  });
});
