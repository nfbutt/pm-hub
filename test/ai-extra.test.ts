// The new pieces: a new issue can carry a description, the model can be checked properly,
// and a model-written epic becomes a description and a set of stories.
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { normalizeProject } from "../src/model/normalize";
import { detectMapping } from "../src/model/mapping";
import { applyOps } from "../src/model/ops";
import { newItem } from "../src/model/edits";
import { checkDraft, draftOps } from "../src/model/plan/draft";
import { testModel, type LocalSettings } from "../src/ai/local";
import { checkEpic, promptEpic } from "../src/ai/plan";

const f = makeFixture("2026-10-19");
const project = normalizeProject(DEMO_OWNER, f.meta, f.items, "2026-10-19T12:00:00Z");
const mapping = detectMapping(project);

describe("a new issue can carry a description", () => {
  it("keeps the body it was given", () => {
    const ops = newItem(project, mapping, "A new epic", { epic: true, body: "What this is for." });
    expect(ops[0]!.kind).toBe("create");
    if (ops[0]!.kind !== "create") return;
    expect(ops[0]!.item.body).toBe("What this is for.");
    const applied = applyOps(project, ops);
    expect(applied.project.items.find(i => i.title === "A new epic")!.body).toBe("What this is for.");
  });

  it("has no body when there was none", () => {
    const ops = newItem(project, mapping, "A plain epic", { epic: true });
    if (ops[0]!.kind !== "create") return;
    expect(ops[0]!.item.body).toBeUndefined();
  });
});

describe("an epic written by a model", () => {
  it("becomes a description and a set of stories", () => {
    const answer = {
      title: "Payment retries",
      summary: "When a payment fails, try it again over the next few days.",
      release: null, start: "2026-11-02", end: "2026-11-20",
      stories: [
        { title: "Retry schedule", why: "Decide when to try again.", days: 3, best: 2, worst: 6 },
        { title: "Retry worker", why: "Do the retrying.", days: 5 },
      ],
    };
    expect(checkEpic(answer)).toBe(true);
    const { draft } = checkDraft(project, mapping, { name: answer.title, summary: answer.summary, epics: [{ ...answer, why: answer.summary, after: [] }] });
    expect(draft.epics).toHaveLength(1);
    const ops = draftOps(project, mapping, draft);
    const epic = ops.find(o => o.kind === "create" && o.item.title === "Payment retries");
    expect(epic?.kind).toBe("create");
    if (epic?.kind !== "create") return;
    // The summary is the description of the issue.
    expect(epic.item.body).toContain("When a payment fails");
    // And the stories are under it.
    const stories = ops.filter(o => o.kind === "create" && o.item.title !== "Payment retries");
    expect(stories).toHaveLength(2);
    expect(stories.every(o => o.kind === "create" && o.item.parentKey === epic.key)).toBe(true);
  });

  it("will not accept an answer that is not an epic with stories", () => {
    expect(checkEpic({ title: "No summary" })).toBe(false);
    expect(checkEpic({ title: "x", summary: "y", stories: [] })).toBe(false);
    expect(checkEpic({ title: "x", summary: "y", stories: [{ why: "no title" }] })).toBe(false);
  });

  it("asks for the epic in the project's own words", () => {
    const prompt = promptEpic("A billing rework", ["Release 1"], ["area: api"], "2026-10-19");
    expect(prompt).toContain("A billing rework");
    expect(prompt).toContain("Release 1");
    expect(prompt).toContain("2026-10-19");
    expect(prompt).toContain("summary");
  });
});

describe("checking the model", () => {
  const settings: LocalSettings = { enabled: true, base: "http://localhost:11434/v1", chatModel: "qwen3", embedModel: "qwen3-embedding" };
  afterEach(() => vi.unstubAllGlobals());

  const stub = (chat: unknown, embed: unknown) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const body = url.endsWith("/embeddings") ? embed : chat;
      return body === null ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => body };
    }));
  };

  it("says everything works when it does", async () => {
    stub({ choices: [{ message: { content: "ready" } }] }, { data: [{ embedding: [1, 2] }] });
    const result = await testModel(settings);
    expect(result.ok).toBe(true);
    expect(result.chat).toBe(true);
    expect(result.embed).toBe(true);
    expect(result.fix).toBeNull();
  });

  it("says which half is missing", async () => {
    stub({ choices: [{ message: { content: "ready" } }] }, null);
    const result = await testModel(settings);
    expect(result.ok).toBe(true);
    expect(result.embed).toBe(false);
    expect(result.fix).toContain("ollama pull");
  });

  it("refuses an address that is not on this computer", async () => {
    const result = await testModel({ ...settings, base: "https://api.openai.com/v1" });
    expect(result.ok).toBe(false);
    expect(result.fix).toContain("localhost");
  });
});
