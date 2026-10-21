// The local model: a client that only ever talks to this computer, and what happens to
// the Epic Map when the model is there, when it answers nonsense, and when it is down.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chatJson, checkCategoryMix, checkGapIdeas, checkOverlapWhy, embed, isLocalBase, testConnection,
} from "../src/ai/local";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { normalizeProject } from "../src/model/normalize";
import { detectMapping } from "../src/model/mapping";
import { analyze } from "../src/model/epicmap";

const settings = { enabled: true, base: "http://localhost:11434/v1", chatModel: "qwen3", embedModel: "qwen3-embedding" };

/** A stand-in for fetch that answers from a handler. */
function stubFetch(handler: (url: string, body: unknown) => unknown) {
  const mock = vi.fn(async (url: string, init: { body?: string }) => {
    const body = init.body ? JSON.parse(init.body) : null;
    const answer = handler(url, body);
    if (answer === null) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => answer };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe("the local client", () => {
  it("only talks to this computer", () => {
    expect(isLocalBase("http://localhost:11434/v1")).toBe(true);
    expect(isLocalBase("http://127.0.0.1:1234/v1")).toBe(true);
    expect(isLocalBase("https://api.openai.com/v1")).toBe(false);
    expect(isLocalBase("http://192.168.1.10:11434/v1")).toBe(false);
    expect(isLocalBase("not a url")).toBe(false);
  });

  it("does not call anything when the address is elsewhere", async () => {
    const mock = stubFetch(() => ({ data: [] }));
    const away = { ...settings, base: "https://api.openai.com/v1" };
    expect(await embed(away, ["hello"])).toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });

  it("asks for embeddings and gives them back in order", async () => {
    const mock = stubFetch((_url, body) => {
      const input = (body as { input: string[] }).input;
      return { data: input.map((text, i) => ({ index: i, embedding: [text.length, i] })) };
    });
    const vectors = await embed(settings, ["ab", "cde"]);
    expect(vectors).toEqual([[2, 0], [3, 1]]);
    // The client asks the server what it has first, so the name it was given can be
    // matched to the one it actually uses.
    const urls = mock.mock.calls.map(c => c[0]);
    expect(urls).toContain("http://localhost:11434/v1/models");
    expect(urls).toContain("http://localhost:11434/v1/embeddings");
  });

  it("drops an answer that is not the shape it should be", async () => {
    stubFetch(() => ({ choices: [{ message: { content: "not json at all" } }] }));
    expect(await chatJson(settings, "s", "u", checkCategoryMix)).toBeNull();

    stubFetch(() => ({ choices: [{ message: { content: JSON.stringify({ name: 42 }) } }] }));
    expect(await chatJson(settings, "s", "u", checkCategoryMix)).toBeNull();

    stubFetch(() => ({ choices: [{ message: { content: JSON.stringify({ ideas: "nope" }) } }] }));
    expect(await chatJson(settings, "s", "u", checkGapIdeas)).toBeNull();

    stubFetch(() => ({ choices: [{ message: { content: JSON.stringify({ explanation: "too long".repeat(200) }) } }] }));
    expect(await chatJson(settings, "s", "u", checkOverlapWhy)).toBeNull();
  });

  it("keeps an answer that passes the check", async () => {
    stubFetch(() => ({ choices: [{ message: { content: JSON.stringify({ name: "mobile notifications" }) } }] }));
    const answer = await chatJson(settings, "s", "u", checkCategoryMix);
    expect(answer).toEqual({ name: "mobile notifications" });
  });

  it("says so when the model is not there", async () => {
    stubFetch(() => null);
    const result = await testConnection(settings);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("No answer");
  });

  it("says so when the model answers", async () => {
    stubFetch(() => ({ choices: [{ message: { content: "ready" } }] }));
    const result = await testConnection(settings);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("ready");
  });
});

describe("the map with and without a model", () => {
  const f = makeFixture("2026-10-19");
  const project = normalizeProject(DEMO_OWNER, f.meta, f.items, "2026-10-19T12:00:00Z");
  const mapping = detectMapping(project);

  it("still works when the endpoint is down", async () => {
    stubFetch(() => null);
    const vectors = await embed(settings, project.items.map(i => i.title));
    expect(vectors).toBeNull();
    const model = analyze(project, mapping, { openOnly: false });
    expect(model.score).toBeGreaterThan(0);
    expect(model.epics.length).toBeGreaterThan(0);
  });

  it("compares by meaning when every item has a vector", () => {
    // A vector per item, made from its title: items with a similar title end up close.
    const vectors = new Map(project.items.map(i => [i.key, [(i.title.length % 5) + 1, i.title.includes("invoice") ? 3 : 1, 1]]));
    const dense = analyze(project, mapping, { openOnly: false, vectors });
    const plain = analyze(project, mapping, { openOnly: false });
    expect(dense.score).not.toBeNull();
    expect(dense.tasks.length).toBe(plain.tasks.length);
    // A missing vector means the map falls back to words.
    const partial = new Map(vectors);
    partial.delete(project.items[0]!.key);
    expect(analyze(project, mapping, { openOnly: false, vectors: partial }).score).toBe(plain.score);
  });
});
