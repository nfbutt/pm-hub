// Making sense of the models a server has. A list of names tells a person nothing; what
// they need to know is which one writes, which one thinks first, and which one is for
// finding meaning.
import { describe, expect, it } from "vitest";
import { describeModel, isThinking, modelKind, modelSize, recommendModels } from "../src/ai/recommend";

describe("what a model is for", () => {
  it("tells an embedding model from a chat model", () => {
    expect(modelKind("qwen3-embedding:0.6b")).toBe("embedding");
    expect(modelKind("nomic-embed-text:latest")).toBe("embedding");
    expect(modelKind("bge-m3")).toBe("embedding");
    expect(modelKind("qwen2.5:7b")).toBe("chat");
    expect(modelKind("qwen/qwen3.5-flash-02-23")).toBe("chat");
  });

  it("knows which models think before they answer", () => {
    // Measured: qwen3:8b took four minutes and forty seconds and never answered.
    expect(isThinking("qwen3:8b")).toBe(true);
    // Measured: qwen2.5:7b answered in six seconds.
    expect(isThinking("qwen2.5:7b")).toBe(false);
    expect(isThinking("qwen/qwen3.5-flash-02-23")).toBe(false);
    expect(isThinking("qwen3-embedding:0.6b")).toBe(false);
    expect(isThinking("deepseek-r1")).toBe(false);
    expect(isThinking("some-thinking-model")).toBe(true);
  });

  it("reads the size out of the tag", () => {
    expect(modelSize("qwen3:8b")).toBe(8);
    expect(modelSize("qwen3-embedding:0.6b")).toBeCloseTo(0.6);
    expect(modelSize("qwen2.5:7b")).toBe(7);
    expect(modelSize("qwen/qwen3.5-flash-02-23")).toBeNull();
    expect(modelSize("nomic-embed-text:latest")).toBeNull();
  });

  it("says one useful thing about each", () => {
    expect(describeModel("qwen2.5:7b").note).toContain("Answers straight away");
    expect(describeModel("qwen3:8b").note).toContain("minutes");
    expect(describeModel("qwen3-embedding:0.6b").note).toContain("vectors");
  });
});

describe("picking the models to use", () => {
  it("picks a model that answers straight away", () => {
    const rec = recommendModels(["qwen3:8b", "qwen2.5:7b", "qwen3-embedding:0.6b", "nomic-embed-text:latest"]);
    expect(rec.chat).toBe("qwen2.5:7b");
    expect(rec.why).toContain("qwen2.5:7b");
  });

  it("picks the smallest model that finds meaning", () => {
    // 639 MB beats 4.7 GB for turning text into vectors: it is fast enough for the map.
    const rec = recommendModels(["qwen3-embedding:0.6b", "qwen3-embedding:8b", "qwen2.5:7b"]);
    expect(rec.embed).toBe("qwen3-embedding:0.6b");
  });

  it("says so when every model thinks first", () => {
    const rec = recommendModels(["qwen3:8b", "qwen3:32b"]);
    expect(rec.chat).toBe("qwen3:8b");
    expect(rec.why).toContain("thinks before it answers");
  });

  it("does nothing when there is nothing to pick", () => {
    const rec = recommendModels([]);
    expect(rec.chat).toBeNull();
    expect(rec.embed).toBeNull();
  });

  it("leaves the embedding model empty when the server has none", () => {
    const rec = recommendModels(["qwen2.5:7b"]);
    expect(rec.chat).toBe("qwen2.5:7b");
    expect(rec.embed).toBeNull();
  });

  it("works with a hosted service, whose names say nothing about size", () => {
    const rec = recommendModels(["qwen/qwen3.5-flash-02-23", "qwen/qwen3.7-flash", "openai/gpt-4o-mini"]);
    expect(rec.chat).toBeTruthy();
    expect(rec.embed).toBeNull();
  });
});
