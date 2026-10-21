// The new pieces: a new issue can carry a description, the model can be checked properly,
// and a model-written epic becomes a description and a set of stories.
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { normalizeProject } from "../src/model/normalize";
import { detectMapping } from "../src/model/mapping";
import { applyOps } from "../src/model/ops";
import { newItem } from "../src/model/edits";
import { checkDraft, draftOps } from "../src/model/plan/draft";
import { chatJson, listModels, resolveModel, testModel, ThinkingModelError, type LocalSettings } from "../src/ai/local";
import { testSpeech } from "../src/ai/voice";
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

  it("counts a thinking model as answering, even when it thinks first", async () => {
    // qwen3 and friends spend their first tokens reasoning, and can run out of room
    // before they answer. The model is working; the test used to say it was not.
    stub({ choices: [{ message: { content: "", reasoning: "Okay, the user wants" } }] }, { data: [{ embedding: [1] }] });
    const result = await testModel(settings);
    expect(result.ok).toBe(true);
    expect(result.chat).toBe(true);
  });

  it("says what the server has, so the fix is a name to type", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/models")) return { ok: true, status: 200, json: async () => ({ data: [{ id: "qwen3:8b" }, { id: "nomic-embed-text:latest" }] }) };
      return { ok: false, status: 500, json: async () => ({}) };
    }));
    const result = await testModel({ ...settings, chatModel: "qwen3" });
    expect(result.ok).toBe(false);
    expect(result.fix).toContain("qwen3:8b");
  });

  it("lists the models a server has", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: "qwen3:8b" }, { id: "nomic-embed-text:latest" }] }) })));
    expect(await listModels(settings)).toEqual(["qwen3:8b", "nomic-embed-text:latest"]);
  });

  it("will not ask a server that is not on this computer", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    expect(await listModels({ ...settings, base: "https://api.openai.com/v1" })).toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("a model that only thinks", () => {
  const settings: LocalSettings = { enabled: true, base: "http://localhost:11434/v1", chatModel: "qwen3", embedModel: "qwen3-embedding:0.6b" };
  afterEach(() => vi.unstubAllGlobals());

  it("is reported as such, not as a model that is not there", async () => {
    // qwen3 spends its budget thinking and never gets to the answer. That is a
    // different problem from a server that is down, and the message says so.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: "", reasoning: "Let me think about this for a while" } }] }),
    })));
    const any = (_v: unknown): _v is unknown => true;
    await expect(chatJson(settings, "s", "u", any)).rejects.toThrow(ThinkingModelError);
  });

  it("is not an error when the model answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: "{\"ok\":true}", reasoning: "" } }] }),
    })));
    const answer = await chatJson(settings, "s", "u", (v): v is { ok: boolean } => typeof v === "object" && v !== null);
    expect(answer).toEqual({ ok: true });
  });

  it("asks for room to finish, and for a bigger context", async () => {
    const mock = vi.fn(async (_url: string, _init?: { body?: string }) => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: "{}", reasoning: "" } }] }),
    }));
    vi.stubGlobal("fetch", mock);
    const any = (_v: unknown): _v is unknown => true;
    await chatJson(settings, "s", "u", any).catch(() => undefined);
    const body = JSON.parse(String(mock.mock.calls[0]![1]?.body ?? "{}"));
    expect(body.max_tokens).toBeGreaterThan(1000);
    expect(body.options.num_ctx).toBeGreaterThan(4096);
  });
});

describe("the microphone needs a speech server", () => {
  const settings: LocalSettings = { enabled: true, base: "http://localhost:11434/v1", chatModel: "qwen3", embedModel: "qwen3-embedding:0.6b", voiceBase: "http://localhost:8000/v1" };
  afterEach(() => vi.unstubAllGlobals());

  it("says so, and says what to run", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no"); }));
    const check = await testSpeech(settings);
    expect(check.ok).toBe(false);
    expect(check.message).toContain("localhost:8000");
    expect(check.fix).toBeTruthy();
  });

  it("is happy when there is one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })));
    expect((await testSpeech(settings)).ok).toBe(true);
  });

  it("will not ask a server that is not on this computer", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    expect((await testSpeech({ ...settings, voiceBase: "https://speech.example.com/v1" })).ok).toBe(false);
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("finding the model the server actually has", () => {
  const settings: LocalSettings = { enabled: true, base: "http://localhost:11434/v1", chatModel: "qwen3", embedModel: "qwen3-embedding", voiceBase: "http://localhost:8000/v1", voiceModel: "whisper-1" };
  afterEach(() => vi.unstubAllGlobals());

  const withModels = (models: string[], base = "http://localhost:11434/v1") => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: models.map(id => ({ id })) }) })));
    return { ...settings, base };
  };

  it("finds the model when only the family name was written", async () => {
    withModels(["qwen3:8b", "qwen3-embedding:0.6b"], "http://localhost:9010/v1");
    const local = { ...settings, base: "http://localhost:9010/v1" };
    expect(await resolveModel(local, "qwen3")).toBe("qwen3:8b");
    expect(await resolveModel(local, "qwen3-embedding")).toBe("qwen3-embedding:0.6b");
  });

  it("takes the smallest of a family, so a name never drags in a huge model", async () => {
    withModels(["qwen3-embedding:0.6b", "qwen3-embedding:4b", "qwen3-embedding:8b"], "http://localhost:1234/v1");
    expect(await resolveModel({ ...settings, base: "http://localhost:1234/v1" }, "qwen3-embedding")).toBe("qwen3-embedding:0.6b");
  });

  it("leaves a name alone when the server has it", async () => {
    withModels(["qwen3:8b"], "http://localhost:2345/v1");
    expect(await resolveModel({ ...settings, base: "http://localhost:2345/v1" }, "qwen3:8b")).toBe("qwen3:8b");
  });

  it("leaves a name alone when the server cannot be asked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no"); }));
    expect(await resolveModel({ ...settings, base: "http://localhost:3456/v1" }, "qwen3")).toBe("qwen3");
  });
});
