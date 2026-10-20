// Talking to a model running on the user's own machine (Ollama, LM Studio, llama.cpp…).
// Every request goes to localhost and nowhere else, and the GitHub token is never part of
// one. Anything that goes wrong comes back as null, so the caller can fall back to
// pm-hub's own analysis.

export interface LocalSettings {
  /** Off by default: pm-hub works without a model. */
  enabled: boolean;
  /** An OpenAI-compatible base URL, e.g. http://localhost:11434/v1 */
  base: string;
  chatModel: string;
  embedModel: string;
}

export const defaultLocal: LocalSettings = {
  enabled: false, base: "http://localhost:11434/v1", chatModel: "qwen3", embedModel: "qwen3-embedding",
};

/** How long to wait for the model before giving up and using pm-hub's own analysis. */
export const TIMEOUT_MS = 20000;

/**
 * Only this computer is allowed. The promise in the README is that nothing leaves the
 * machine, so a base URL that points anywhere else is refused rather than called.
 */
export function isLocalBase(base: string): boolean {
  let u: URL;
  try { u = new URL(base); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

const trimSlash = (s: string) => s.replace(/\/+$/, "");

async function post(settings: LocalSettings, path: string, body: unknown): Promise<unknown | null> {
  if (!isLocalBase(settings.base)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${trimSlash(settings.base)}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Embeddings for a batch of texts. Returns null when the model is not there, so the
 * caller can carry on with the words alone.
 */
export async function embed(settings: LocalSettings, texts: string[]): Promise<number[][] | null> {
  if (!texts.length) return [];
  const data = await post(settings, "/embeddings", { model: settings.embedModel, input: texts });
  const rows = (data as { data?: { index?: number; embedding?: unknown }[] } | null)?.data;
  if (!Array.isArray(rows) || rows.length !== texts.length) return null;
  const out: number[][] = new Array(texts.length);
  for (const row of rows) {
    if (!row || typeof row.index !== "number" || !Array.isArray(row.embedding)) return null;
    const vector = row.embedding.filter((n): n is number => typeof n === "number");
    if (!vector.length) return null;
    out[row.index] = vector;
  }
  return out.every(v => Array.isArray(v)) ? out : null;
}

/**
 * One chat answer, asked for as JSON. The answer is checked by `check`; anything that
 * does not pass is dropped, because a model that made something up is worse than no model.
 */
export async function chatJson(settings: LocalSettings, system: string, user: string, check: (v: unknown) => boolean): Promise<unknown | null> {
  const data = await post(settings, "/chat/completions", {
    model: settings.chatModel, temperature: 0,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    response_format: { type: "json_object" },
  });
  const content = (data as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return null; }
  return check(parsed) ? parsed : null;
}

/** Checks the model is there and answers, without asking it anything hard. */
export async function testConnection(settings: LocalSettings): Promise<{ ok: boolean; message: string }> {
  if (!isLocalBase(settings.base)) return { ok: false, message: "The address has to be on this computer: localhost or 127.0.0.1." };
  const data = await post({ ...settings, enabled: true }, "/chat/completions", {
    model: settings.chatModel, temperature: 0, max_tokens: 32,
    messages: [{ role: "user", content: "Reply with the single word: ready" }],
  });
  const content = (data as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return { ok: false, message: "No answer from the model. Check the address and the model name." };
  return { ok: true, message: `The model answered: “${content.trim().slice(0, 60)}”` };
}

// ---------------------------------------------------------------- answers

export interface CategoryMix { name: string }
export interface OverlapWhy { explanation: string }
export interface GapIdea { title: string; why: string; taskKeys: string[] }
export interface GapIdeas { ideas: GapIdea[] }

const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** The model's name for an epic's mix of work. */
export function checkCategoryMix(v: unknown): v is CategoryMix {
  return typeof v === "object" && v !== null && isText((v as CategoryMix).name) && (v as CategoryMix).name.length <= 120;
}

/** One sentence about why two epics overlap. */
export function checkOverlapWhy(v: unknown): v is OverlapWhy {
  return typeof v === "object" && v !== null && isText((v as OverlapWhy).explanation) && (v as OverlapWhy).explanation.length <= 400;
}

/** Up to three new epics the model thinks are missing. */
export function checkGapIdeas(v: unknown): v is GapIdeas {
  if (typeof v !== "object" || v === null) return false;
  const ideas = (v as GapIdeas).ideas;
  if (!Array.isArray(ideas) || ideas.length > 5) return false;
  return ideas.every(i => typeof i === "object" && i !== null && isText(i.title) && isText(i.why)
    && Array.isArray(i.taskKeys) && i.taskKeys.every(k => typeof k === "string"));
}

// ---------------------------------------------------------------- prompts

export const SYSTEM_CATEGORY_MIX = "You name what a piece of work is really about. Answer with JSON only.";

export function promptCategoryMix(epicTitle: string, tasks: string[], histogram: [string, number][]): string {
  return [
    `Epic: ${epicTitle}`,
    `Its tasks: ${tasks.slice(0, 30).join("; ")}`,
    `Kinds of work it contains: ${histogram.map(([k, n]) => `${k} ${n}`).join(", ")}`,
    "Name this mix of work in a few words, e.g. \"mobile notifications with a little data\". Answer with {\"name\": \"...\"}.",
  ].join("\n");
}

export const SYSTEM_OVERLAP = "You explain why two pieces of work overlap, in one short sentence. Answer with JSON only.";

export function promptOverlapWhy(a: string, b: string, shared: string[], tasksA: string[], tasksB: string[]): string {
  return [
    `Epic A: ${a}`,
    `Epic B: ${b}`,
    shared.length ? `They share these words: ${shared.join(", ")}` : "They share no words in common.",
    `A's tasks: ${tasksA.slice(0, 12).join("; ")}`,
    `B's tasks: ${tasksB.slice(0, 12).join("; ")}`,
    "In one sentence, say what the two have in common and whether they should be merged. Answer with {\"explanation\": \"...\"}.",
  ].join("\n");
}

export const SYSTEM_GAP_IDEAS = "You spot work that has no home. Answer with JSON only.";

export function promptGapIdeas(epicTitles: string[], histogram: [string, number][], loose: string[]): string {
  return [
    `The plan has these epics: ${epicTitles.join(", ")}`,
    `Work in the plan: ${histogram.map(([k, n]) => `${k} ${n}`).join(", ")}`,
    `Work that belongs to no epic: ${loose.slice(0, 25).join("; ")}`,
    "Suggest up to three new epics that would give that work a home. Answer with {\"ideas\": [{\"title\": \"...\", \"why\": \"...\", \"taskKeys\": []}]}.",
  ].join("\n");
}
