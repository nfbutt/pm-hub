// The pill in the top bar remembers what the last connection check found. A check that
// has gone stale, or one that was about a different setup, says nothing about now — and
// a check that failed an hour ago must not leave the app saying "AI not answering" for
// ever.
import { afterEach, describe, expect, it } from "vitest";
import { FRESH_MS, readCheck, writeCheck } from "../src/views/ai/checkCache";
import type { LocalSettings, ModelCheck } from "../src/ai/local";

const settings: LocalSettings = { enabled: true, base: "http://localhost:11434/v1", chatModel: "qwen2.5:7b", embedModel: "qwen3-embedding:0.6b" };
const failed: ModelCheck = { ok: false, chat: false, embed: false, message: "Nothing answered on that address.", fix: null };
const worked: ModelCheck = { ok: true, chat: true, embed: true, message: "Everything works.", fix: null };

/** A local storage to keep the check in. */
function withStorage() {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

afterEach(() => { delete (globalThis as { localStorage?: Storage }).localStorage; });

describe("what the pill remembers", () => {
  it("keeps a check it has just made", () => {
    withStorage();
    writeCheck(worked, settings, 1000);
    expect(readCheck(settings, 2000)?.check.ok).toBe(true);
  });

  it("does not believe a check that has gone stale", () => {
    withStorage();
    writeCheck(failed, settings, 1000);
    // Six minutes later, the model may well be up again.
    expect(readCheck(settings, 1000 + FRESH_MS + 1)).toBeNull();
  });

  it("does not read a check of one setup as a check of another", () => {
    withStorage();
    writeCheck(worked, settings, 1000);
    const other = { ...settings, base: "https://openrouter.ai/api/v1", chatModel: "qwen/qwen3.5-flash-02-23" };
    expect(readCheck(other, 2000)).toBeNull();
    // And a different model on the same server is a different setup.
    expect(readCheck({ ...settings, chatModel: "qwen3:8b" }, 2000)).toBeNull();
  });

  it("says nothing when there is no check to be had", () => {
    withStorage();
    expect(readCheck(settings)).toBeNull();
  });
});
