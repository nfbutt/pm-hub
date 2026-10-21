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
  /**
   * The speech server, which is usually a different program: the chat model does not
   * transcribe. Speaches and friends speak the OpenAI transcription API.
   */
  voiceBase?: string;
  voiceModel?: string;
  /**
   * How long to wait for the model, in seconds. A model on this machine can take
   * minutes: a thinking model fills its context before it answers.
   */
  timeoutSeconds?: number;
  /**
   * How many tokens the model may use. Without a limit a thinking model can spend the
   * whole budget thinking and never answer.
   */
  maxTokens?: number;
  /**
   * How much context the model gets. Ollama's own default is 4096, which is not much.
   */
  contextTokens?: number;
  /**
   * Permission to talk to a model that is not on this computer. Off by default: a hosted
   * model reads the text of your issues.
   */
  allowRemote?: boolean;
}

/** Where the speech server usually lives. */
export const DEFAULT_VOICE_BASE = "http://localhost:8000/v1";
export const DEFAULT_VOICE_MODEL = "whisper-1";

export const defaultLocal: LocalSettings = {
  enabled: false, base: "http://localhost:11434/v1", chatModel: "qwen3", embedModel: "qwen3-embedding:0.6b",
  voiceBase: DEFAULT_VOICE_BASE, voiceModel: DEFAULT_VOICE_MODEL,
};

/** How long to wait for the model before giving up and using pm-hub's own analysis. */
export const TIMEOUT_MS = 20000;

/** The default wait. Long, because a local model is not a hosted one. */
export const DEFAULT_TIMEOUT = 180;
/** How many tokens a model may use. */
export const DEFAULT_MAX_TOKENS = 4000;
/** How much context a model gets. Ollama's own default is 4096, which is not much. */
export const DEFAULT_CONTEXT = 16384;

/**
 * May pm-hub talk to this address? A model on this computer, always. A model somewhere
 * else, only with permission — because it reads the text of your issues.
 */
export function canCall(settings: LocalSettings): { ok: boolean; why: string | null } {
  if (isLocalBase(settings.base)) return { ok: true, why: null };
  if (settings.allowRemote) return { ok: true, why: null };
  const host = (() => { try { return new URL(settings.base).host; } catch { return settings.base; } })();
  return { ok: false, why: `${host} is not on this computer. A model that runs elsewhere reads the text of your issues, so that has to be allowed first.` };
}

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

import { readApiKey } from "../store/key";

async function post(settings: LocalSettings, path: string, body: unknown): Promise<unknown | null> {
  if (!canCall(settings).ok) return null;
  const ctrl = new AbortController();
  const wait = Math.max(5, settings.timeoutSeconds ?? DEFAULT_TIMEOUT) * 1000;
  const timer = setTimeout(() => ctrl.abort(), wait);
  try {
    const key = readApiKey();
    const res = await fetch(`${trimSlash(settings.base)}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
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
  const data = await post(settings, "/embeddings", {
    model: await resolveModel(settings, settings.embedModel), input: texts,
    options: { num_ctx: settings.contextTokens ?? DEFAULT_CONTEXT },
  });
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
export async function chatJson<T>(settings: LocalSettings, system: string, user: string, check: (v: unknown) => v is T): Promise<T | null> {
  const data = await post(settings, "/chat/completions", {
    model: await resolveModel(settings, settings.chatModel), temperature: 0,
    max_tokens: settings.maxTokens ?? DEFAULT_MAX_TOKENS,
    options: { num_ctx: settings.contextTokens ?? DEFAULT_CONTEXT },
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    response_format: { type: "json_object" },
  });
  const message = (data as { choices?: { message?: { content?: unknown; reasoning?: unknown } }[] } | null)?.choices?.[0]?.message;
  const content = typeof message?.content === "string" ? message.content : "";
  if (!content.trim()) {
    // A thinking model that ran out of budget says nothing and thinks a lot. Say so,
    // rather than "the model did not answer".
    const thought = typeof message?.reasoning === "string" ? message.reasoning : "";
    if (thought.trim()) throw new ThinkingModelError();
    return null;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return null; }
  return check(parsed) ? parsed : null;
}

/**
 * The model used its whole answer thinking and never got to the answer. It is not a
 * broken setup: it is a model that needs a bigger budget, or one that answers straight
 * away.
 */
export class ThinkingModelError extends Error {
  constructor() {
    super("The model spent its whole budget thinking and never answered. A model that answers straight away — qwen2.5, for one — will be far quicker, or give the model a bigger budget in Settings.");
    this.name = "ThinkingModelError";
  }
}

/** Checks the model is there and answers, without asking it anything hard. */
export async function testConnection(settings: LocalSettings): Promise<{ ok: boolean; message: string }> {
  if (!isLocalBase(settings.base)) return { ok: false, message: "The address has to be on this computer: localhost or 127.0.0.1." };
  const data = await post({ ...settings, enabled: true }, "/chat/completions", {
    model: settings.chatModel, temperature: 0, max_tokens: 256,
    messages: [{ role: "user", content: "Reply with the single word: ready" }],
  });
  const message = (data as { choices?: { message?: { content?: unknown; reasoning?: unknown } }[] } | null)?.choices?.[0]?.message;
  const content = typeof message?.content === "string" ? message.content : "";
  // A thinking model may think first and run out of room; its reasoning is still an answer.
  const reasoning = typeof message?.reasoning === "string" ? message.reasoning : "";
  if (!content.trim() && !reasoning.trim()) return { ok: false, message: "No answer from the model. Check the address and the model name." };
  return { ok: true, message: `The model answered: “${(content || reasoning).trim().slice(0, 60)}”` };
}

/** What the model can and cannot do. */
export interface ModelCheck {
  ok: boolean;
  /** The model answers questions. */
  chat: boolean;
  /** The model can turn text into vectors. */
  embed: boolean;
  /** One line, in words a person can act on. */
  message: string;
  /** What to do about it, when there is something to do. */
  fix: string | null;
}

/** The models a server has, remembered for a minute so we do not ask on every call. */
let modelCache: { at: number; base: string; models: string[] } | null = null;

/**
 * The models a local server has. The names it uses are not always the ones you would
 * guess — "qwen3" is not the same as "qwen3:8b" — so it is better to ask.
 */
export async function listModels(settings: LocalSettings): Promise<string[] | null> {
  if (!canCall(settings).ok) return null;
  if (modelCache && modelCache.base === settings.base && Date.now() - modelCache.at < 60000) return modelCache.models;
  try {
    const key = readApiKey();
    const res = await fetch(`${trimSlash(settings.base)}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
    if (!res.ok) return null;
    const data = await res.json();
    const rows = (data as { data?: { id?: unknown }[] }).data;
    if (!Array.isArray(rows)) return null;
    const ids = rows.map(r => r?.id).filter((id): id is string => typeof id === "string");
    if (!ids.length) return null;
    modelCache = { at: Date.now(), base: settings.base, models: ids };
    return ids;
  } catch {
    return null;
  }
}

/** How big a model is, from its tag: "qwen3:8b" is eight. */
const sizeOf = (name: string): number => {
  const m = name.split(":")[1]?.match(/([0-9.]+)\s*([bm])/i);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const n = Number(m[1]);
  return m[2]!.toLowerCase() === "m" ? n / 1000 : n;
};

/** Forgets the remembered list, so a newly pulled model is found straight away. */
export function forgetModels() { modelCache = null; }

/**
 * The name to use for a model: the one asked for, or the closest the server actually
 * has. Servers tag their models ("qwen3:8b"), and people write the family name
 * ("qwen3"), which the server does not know.
 */
export async function resolveModel(settings: LocalSettings, name: string): Promise<string> {
  if (!settings.enabled || !canCall(settings).ok) return name;
  const models = await listModels(settings);
  if (!models || models.includes(name)) return name;
  const base = name.split(":")[0]!;
  const same = models.filter(m => m === name || m.split(":")[0] === base);
  if (!same.length) return name;
  // Several sizes of the same family: take the smallest, so a name never drags a
  // sixteen gigabyte model into every call.
  return same.sort((a, b) => sizeOf(a) - sizeOf(b))[0]!;
}

/**
 * Checks the model properly: the chat endpoint and the embeddings endpoint, one at a time,
 * so the answer says which of them is the problem.
 */
export async function testModel(settings: LocalSettings): Promise<ModelCheck & { seconds: number }> {
  if (!canCall(settings).ok) {
    return { ok: false, chat: false, embed: false, message: "That address is not on this computer.", fix: canCall(settings).why ?? "Use localhost or 127.0.0.1.", seconds: 0 };
  }
  const started = Date.now();
  const chat = await post({ ...settings, enabled: true }, "/chat/completions", {
    model: await resolveModel(settings, settings.chatModel), temperature: 0, max_tokens: 256,
    messages: [{ role: "user", content: "Reply with the single word: ready" }],
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  const message = (chat as { choices?: { message?: { content?: unknown; reasoning?: unknown } }[] } | null)?.choices?.[0]?.message;
  const said = typeof message?.content === "string" ? message.content : "";
  // A thinking model spends its first tokens reasoning, and can run out of room before
  // it answers. Its reasoning still means the model is there and working.
  const thought = typeof message?.reasoning === "string" && message.reasoning.trim().length > 0;
  const chatOk = said.trim().length > 0 || thought;

  const embed = await post({ ...settings, enabled: true }, "/embeddings", { model: settings.embedModel, input: ["ready"] });
  const embedOk = Array.isArray((embed as { data?: unknown[] } | null)?.data);

  const slow = seconds > 20 ? ` It took ${seconds} seconds, so the model is slow: a thinking model (qwen3 and its family) fills its context before it answers, and a smaller one that answers straight away will feel much better.` : "";
  if (chatOk && embedOk) return { ok: true, chat: true, embed: true, message: `Everything works. The model answered “${(said || "yes").trim().slice(0, 40)}” in ${seconds} seconds.${slow}`, fix: null, seconds };
  if (chatOk) return {
    ok: true, chat: true, embed: false, seconds,
    message: "The model answers, but it cannot turn text into vectors.",
    fix: `If the server has an embedding model, name it here. Without one the map compares by words rather than by meaning.`,
  };
  if (embedOk) return { ok: true, chat: false, embed: true, message: "The model can turn text into vectors, but it does not answer.", fix: `Pull the chat model: ollama pull ${settings.chatModel}`, seconds };
  // Say what the server does have, so the fix is a name to type rather than a guess.
  const models = await listModels(settings);
  return {
    ok: false, chat: false, embed: false,
    message: `Nothing answered on that address${seconds ? ` after ${seconds} seconds` : ""}.`,
    fix: models?.length
      ? `The server has ${models.join(", ")}. Is the model called “${settings.chatModel}”?`
      : `Is the model server running, and is it called “${settings.chatModel}”?`,
    seconds,
  };
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

// ---------------------------------------------------------------- dependencies

export interface ProposedLink { from: string; to: string; evidence: string }
export interface ProposedRelease { release: string; epics: string[]; why: string }

export const SYSTEM_DEPENDENCIES = [
  "You find dependencies between work items. You only use the item keys you are given.",
  "You quote the words that show the dependency, copied exactly from one of the two items.",
  "You answer with JSON only, and you leave out anything you cannot quote.",
].join(" ");

/**
 * Asks which of the candidate pairs really block each other. The pairs come from the
 * plan itself, so the model is judging what is in front of it rather than inventing work.
 */
export function promptDependencies(pairs: { a: string; b: string; aTitle: string; bTitle: string; shared: string[] }[]): string {
  const lines = pairs.map(p =>
    `${p.a} | ${p.b}\n  A: ${p.aTitle}\n  B: ${p.bTitle}${p.shared.length ? `\n  They share: ${p.shared.join(", ")}` : ""}`);
  return [
    "Which of these pairs is a real dependency: one item cannot start until the other is done?",
    "Look for wording about needing, waiting for, after, once, depends on, blocked by, or a feature that needs another.",
    "",
    ...lines,
    "",
    "Answer with {\"links\": [{\"from\": \"<key>\", \"to\": \"<key>\", \"evidence\": \"<words copied from one of the two items>\"}]}.",
    "For each link, \"from\" is the item that blocks, and \"to\" is the item that waits.",
    "Use no more than eight links, and only ones you can quote.",
  ].join("\n");
}

/** Keeps only answers that name real keys and carry a reason. */
export function checkLinks(v: unknown): v is { links: ProposedLink[] } {
  if (typeof v !== "object" || v === null) return false;
  const links = (v as { links?: unknown }).links;
  if (!Array.isArray(links) || links.length > 12) return false;
  return links.every(l => typeof l === "object" && l !== null
    && typeof (l as ProposedLink).from === "string" && typeof (l as ProposedLink).to === "string"
    && typeof (l as ProposedLink).evidence === "string");
}

export const SYSTEM_RELEASES = [
  "You label work with the theme it belongs to, using only the themes you are given.",
  "You answer with JSON only.",
].join(" ");

/**
 * Asks what theme each piece of work belongs to, one label per item. The labels are
 * closed, and pm-hub does the grouping: asking a model to group things itself means the
 * same project comes out grouped differently every time, and a roadmap that churns is
 * worse than no roadmap.
 */
export function promptReleases(epics: { key: string; title: string; release: string | null }[], themes: string[]): string {
  return [
    `The themes you may use: ${themes.join(", ") || "(none)"}`,
    "The work:",
    ...epics.map(e => `  ${e.key} | ${e.title}${e.release ? ` | currently in ${e.release}` : " | in no release"}`),
    "Label each piece of work with the one theme it belongs to. If it belongs to none of them, leave it out.",
    "Answer with {\"themes\": [{\"key\": \"<key>\", \"theme\": \"<theme>\"}]}.",
  ].join("\n");
}

/** Keeps only answers that name a real key and a theme. */
export function checkReleases(v: unknown): v is { themes: { key: string; theme: string }[] } {
  if (typeof v !== "object" || v === null) return false;
  const themes = (v as { themes?: unknown }).themes;
  if (!Array.isArray(themes) || themes.length > 200) return false;
  return themes.every(t => typeof t === "object" && t !== null
    && typeof (t as { key?: unknown }).key === "string"
    && typeof (t as { theme?: unknown }).theme === "string");
}
