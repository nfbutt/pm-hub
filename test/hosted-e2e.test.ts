// The whole path to a hosted model, against a server that behaves like OpenRouter:
// the address, the bearer token, the JSON answer, and the error a wrong key gets.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { chatJson, testModel, type LocalSettings } from "../src/ai/local";
import { checkEpic, promptEpic } from "../src/ai/plan";

const KEY = "sk-or-test-key";
let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const auth = req.headers.authorization;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (auth !== `Bearer ${KEY}`) {
      send(401, { error: { code: 401, message: "No auth credentials found" } });
      return;
    }
    if (req.url === "/api/v1/models") {
      send(200, { data: [{ id: "qwen/qwen3.5-flash-02-23" }, { id: "qwen/qwen3.7-flash" }] });
      return;
    }
    if (req.url === "/api/v1/chat/completions") {
      let body = "";
      req.on("data", c => { body += c; });
      req.on("end", () => {
        const ask = JSON.parse(body || "{}");
        // It must name the model.
        if (!ask.model) {
          send(400, { error: { message: "Bad request" } });
          return;
        }
        send(200, {
          id: "gen-test", object: "chat.completion", model: ask.model,
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
            title: "Billing rework", summary: "An invoice screen and a retry service.",
            release: null, start: "2026-11-02", end: "2026-11-20",
            stories: [{ title: "Invoice list", why: "List them.", days: 3, best: 2, worst: 6 }],
          }) } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0.00001 },
        });
      });
      return;
    }
    send(404, { error: { message: "No such endpoint" } });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  base = `http://127.0.0.1:${port}/api/v1`;
});

afterAll(() => { server.close(); });

const settings = (): LocalSettings => ({ enabled: true, base, chatModel: "qwen/qwen3.5-flash-02-23", embedModel: "qwen/qwen3-embedding-8b" });

describe("a hosted model, end to end", () => {
  it("needs the key, and says so without it", async () => {
    const any = (_v: unknown): _v is unknown => true;
    // No key in the store: the server says no, and pm-hub passes on what it said.
    await expect(chatJson(settings(), "s", "u", any)).rejects.toThrow("No auth credentials found");
  });

  it("answers with a plan when the key is there", async () => {
    const store = new Map<string, string>([["pm-hub:model-key", KEY]]);
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    const answer = await chatJson(settings(), "s", "u", checkEpic);
    expect(answer).toBeTruthy();
    expect(answer?.title).toBe("Billing rework");
    expect(answer?.stories).toHaveLength(1);
    // And the prompt the planner would send is the one the server accepted.
    expect(promptEpic("A billing rework", ["Release 1"], [], "2026-10-21")).toContain("A billing rework");
    vi.unstubAllGlobals();
  });

  it("checks the connection and reports what it found", async () => {
    const store = new Map<string, string>([["pm-hub:model-key", KEY]]);
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    const result = await testModel(settings());
    // It answers, and this service has no embedding model.
    expect(result.chat).toBe(true);
    expect(result.embed).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.fix).toContain("words rather than by meaning");
    vi.unstubAllGlobals();
  });
});
