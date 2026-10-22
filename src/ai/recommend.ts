// Making sense of the models a server has. The names are not what you would guess —
// "qwen3:8b" is a thinking model that takes minutes, "qwen2.5:7b" answers in seconds,
// and "qwen3-embedding:0.6b" cannot write a sentence at all — so the app says what each
// one is for rather than leaving a list of names to interpret.

export type ModelKind = "chat" | "embedding";

/** What a model is for, from its name. */
export function modelKind(id: string): ModelKind {
  return /embed|bge|gte[-_]?base|e5[-_]|nomic[-_]embed/i.test(id) ? "embedding" : "chat";
}

/**
 * A model that thinks before it answers can take minutes, and a plan is exactly the
 * kind of thing it overthinks. These are the ones to point people away from.
 */
export function isThinking(id: string): boolean {
  if (modelKind(id) === "embedding") return false;
  if (/thinking|reason/i.test(id)) return true;
  // The qwen3 family thinks; qwen2.5 and the flash models answer straight away.
  return /^qwen3(:|$)/i.test(id);
}

/** How big a model is, from its tag: "qwen3:8b" is eight, "0.6b" is six tenths. */
export function modelSize(id: string): number | null {
  const m = id.split(":")[1]?.match(/([0-9.]+)\s*([bm])/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2]!.toLowerCase() === "m" ? n / 1000 : n;
}

export interface ModelNote {
  id: string;
  kind: ModelKind;
  /** True when the model thinks before it answers. */
  thinking: boolean;
  /** How big, in billions of parameters, when the name says. */
  size: number | null;
  /** One line about what it is good for. */
  note: string;
}

/** What to say about a model, so a list of names says something. */
export function describeModel(id: string): ModelNote {
  const kind = modelKind(id);
  const thinking = isThinking(id);
  const size = modelSize(id);
  const howBig = size === null ? "" : size < 1 ? ` · ${Math.round(size * 1000)}M` : ` · ${size}B`;
  if (kind === "embedding") {
    return { id, kind, thinking, size, note: `Turns text into vectors, so the map can compare by meaning. Does not write.${howBig}` };
  }
  if (thinking) {
    return { id, kind, thinking, size, note: `Thinks before it answers, so it can take minutes. Good for hard questions, poor for drafting a plan.${howBig}` };
  }
  return { id, kind, thinking, size, note: `Answers straight away.${howBig}` };
}

/** What the app would pick, and why. */
export interface Recommendation {
  chat: string | null;
  embed: string | null;
  /** Why the chat model was chosen, for the line under the button. */
  why: string;
}

/**
 * The models to use, from what the server has. The chat model is one that answers
 * straight away, of a size worth having; the embedding model is the smallest one that
 * turns text into vectors, because a big one is slow for no gain.
 */
export function recommendModels(ids: string[]): Recommendation {
  const chats = ids.filter(i => modelKind(i) === "chat");
  const embeddings = ids.filter(i => modelKind(i) === "embedding");

  const quick = chats.filter(i => !isThinking(i));
  // A model around seven billion parameters is the sweet spot: good enough to write a
  // plan, quick enough to answer in seconds.
  const bySweetness = (a: string, b: string) => {
    const sa = modelSize(a), sb = modelSize(b);
    if (sa === null && sb === null) return 0;
    if (sa === null) return 1;
    if (sb === null) return -1;
    return Math.abs(sa - 7) - Math.abs(sb - 7);
  };
  let chat: string | null = null;
  let why = "";
  if (quick.length) {
    chat = [...quick].sort(bySweetness)[0]!;
    why = `${chat} answers straight away, which is what the planner needs.`;
  } else if (chats.length) {
    // Everything here thinks first. The smallest is the least painful.
    chat = [...chats].sort((a, b) => (modelSize(a) ?? Infinity) - (modelSize(b) ?? Infinity))[0]!;
    why = `Every model here thinks before it answers, so it can take minutes. ${chat} is the smallest.`;
  }
  const embed = embeddings.length
    ? [...embeddings].sort((a, b) => (modelSize(a) ?? Infinity) - (modelSize(b) ?? Infinity))[0]!
    : null;
  return { chat, embed, why };
}
