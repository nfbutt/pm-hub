// What pm-hub actually sends to a model. These are the requests a hosted service sees, so
// they are worth pinning down: the address, the headers, and the body.
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatJson, embed, listModels, ModelError, resolveModel, type LocalSettings } from "../src/ai/local";

const hosted: LocalSettings = {
  enabled: true, base: "https://openrouter.ai/api/v1", chatModel: "qwen/qwen3.5-flash-02-23",
  embedModel: "qwen/qwen3-embedding-8b", allowRemote: true,
};

afterEach(() => vi.unstubAllGlobals());

/** A session storage to keep a key in, so the header can be checked. */
function withKey(key: string) {
  const store = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  store.set("pm-hub:model-key", key);
}

/** A fetch that answers by path, and remembers what it was asked. */
function server(answers: Record<string, unknown>, status = 200) {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, init });
    const key = Object.keys(answers).find(k => url.endsWith(k));
    if (key === undefined) return { ok: false, status: 404, json: async () => ({ error: { message: "No such endpoint" } }) };
    return { ok: status < 400, status, json: async () => answers[key] };
  }));
  return calls;
}

describe("what a hosted model is asked", () => {
  it("goes to the right address, with the key, and nothing else", async () => {
    const calls = server({ "/chat/completions": { choices: [{ message: { content: "{\"ok\":true}" } }] } });
    const answer = await chatJson(hosted, "system", "user", (v): v is { ok: boolean } => typeof v === "object" && v !== null);
    expect(answer).toEqual({ ok: true });
    const call = calls.find(c => c.url.endsWith("/chat/completions"))!;
    expect(call.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(call.init.method).toBe("POST");
    expect(call.init.headers["content-type"]).toBe("application/json");
    // The key travels as a bearer token, and only if there is one.
    expect(call.init.headers.authorization).toBeUndefined();
  });

  it("sends the key as a bearer token when there is one", async () => {
    withKey("sk-or-test");
    const calls = server({ "/chat/completions": { choices: [{ message: { content: "{}" } }] } });
    await chatJson(hosted, "s", "u", (v): v is unknown => typeof v === "object" && v !== null);
    const call = calls.find(c => c.url.endsWith("/chat/completions"))!;
    expect(call.init.headers.authorization).toBe("Bearer sk-or-test");
  });

  it("asks for JSON, a temperature and a limit, and nothing a hosted service would reject", async () => {
    const calls = server({ "/chat/completions": { choices: [{ message: { content: "{}" } }] } });
    await chatJson(hosted, "s", "u", (v): v is unknown => typeof v === "object" && v !== null);
    const body = JSON.parse(String(calls.find(c => c.url.endsWith("/chat/completions"))!.init.body));
    expect(body.model).toBe("qwen/qwen3.5-flash-02-23");
    expect(body.messages).toEqual([{ role: "system", content: "s" }, { role: "user", content: "u" }]);
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBeGreaterThan(1000);
    // num_ctx is Ollama's own. Another service forwards what it does not recognise to
    // the model, which is a good way to be rejected.
    expect(body.options).toBeUndefined();
  });

  it("sends Ollama's own fields to Ollama", async () => {
    const calls = server({ "/api/version": { version: "0.5.0" }, "/chat/completions": { choices: [{ message: { content: "{}" } }] } });
    const local = { ...hosted, base: "http://localhost:11434/v1" };
    await chatJson(local, "s", "u", (v): v is unknown => typeof v === "object" && v !== null);
    const body = JSON.parse(String(calls.find(c => c.url.endsWith("/chat/completions"))!.init.body));
    expect(body.options).toEqual({ num_ctx: 16384 });
  });

  it("says what the server said when it says no", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 401,
      json: async () => ({ error: { message: "No auth credentials found" } }),
    })));
    const any = (_v: unknown): _v is unknown => true;
    await expect(chatJson(hosted, "s", "u", any)).rejects.toThrow(ModelError);
    await expect(chatJson(hosted, "s", "u", any)).rejects.toThrow("No auth credentials found");
  });
});

describe("finding a model on a hosted service", () => {
  it("lists them", async () => {
    const at = { ...hosted, base: "https://openrouter.ai/api/v1" };
    server({ "/models": { data: [{ id: "qwen/qwen3.5-flash-02-23" }, { id: "qwen/qwen3.7-flash" }] } });
    expect(await listModels(at)).toEqual(["qwen/qwen3.5-flash-02-23", "qwen/qwen3.7-flash"]);
  });

  it("finds one whose name is a prefix of the one the server has", async () => {
    const at = { ...hosted, base: "https://openrouter.ai/api/v2" };
    server({ "/models": { data: [{ id: "qwen/qwen3.5-flash-02-23" }, { id: "qwen/qwen3.7-flash" }] } });
    expect(await resolveModel(at, "qwen/qwen3.5-flash")).toBe("qwen/qwen3.5-flash-02-23");
  });

  it("finds one whose family name was written", async () => {
    const at = { ...hosted, base: "https://openrouter.ai/api/v3" };
    server({ "/models": { data: [{ id: "qwen/qwen3.5-flash-02-23:free" }] } });
    expect(await resolveModel(at, "qwen/qwen3.5-flash-02-23")).toBe("qwen/qwen3.5-flash-02-23:free");
  });
});

describe("a service with no embedding model", () => {
  it("says the model cannot turn text into vectors, and the map compares by words", async () => {
    server({ "/chat/completions": { choices: [{ message: { content: "ready" } }] } });
    const vectors = await embed(hosted, ["a"]);
    expect(vectors).toBeNull();
  });
});
