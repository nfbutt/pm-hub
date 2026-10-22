// Asking a model to read a sentence the grammar could not. The model is only asked when
// the grammar has nothing, and what it says is checked before it is shown: a target that
// is not in the project, or an action that is not one of ours, is thrown away. The model
// fills in a slot; it does not decide the intent.
import { chatJson, type LocalSettings } from "../../ai/local";
import type { Intent } from "./intent";
import { findTargets } from "./targets";
import type { Project } from "../normalize";
import type { Mapping } from "../mapping";

export const SYSTEM_PHRASE = [
  "You read a request about a project plan and say what it asks for.",
  "You may only use the actions and the item keys you are given. You answer with JSON only.",
].join(" ");

/** The shape the model has to answer, and the check that throws away anything else. */
export function checkIntent(v: unknown): v is { action: string; target?: string; days?: number; value?: string; blocker?: string; into?: string; under?: string; epic?: boolean } {
  if (typeof v !== "object" || v === null) return false;
  const a = (v as { action?: unknown }).action;
  if (typeof a !== "string") return false;
  const allowed = ["shift", "release", "lane", "close", "reopen", "block", "unblock", "merge", "archive", "owner", "create", "undo"];
  if (!allowed.includes(a)) return false;
  const o = v as Record<string, unknown>;
  for (const key of ["target", "value", "blocker", "into", "under"]) {
    if (o[key] !== undefined && typeof o[key] !== "string") return false;
  }
  if (o.days !== undefined && (typeof o.days !== "number" || !Number.isFinite(o.days))) return false;
  if (o.epic !== undefined && typeof o.epic !== "boolean") return false;
  return true;
}

/** The prompt: the sentence, and what it may choose from. */
export function promptPhrase(phrase: string, keys: string[], releases: string[]): string {
  return [
    `Someone said: "${phrase}"`,
    "",
    "The actions you may choose from: shift (move the dates by a number of days), release, lane, close, reopen, block, unblock, merge, archive, owner, create, undo.",
    "The items in the project you may name:",
    ...keys.map(k => `  ${k}`),
    releases.length ? `The releases you may name: ${releases.join(", ")}` : "",
    "",
    'Answer with {"action": "...", "target": "<item key>", ...}. Use only the keys you are given.',
  ].filter(Boolean).join("\n");
}

/**
 * What a model made of a sentence, as an intention — or null, if it named something that
 * is not in the project.
 */
export function toIntent(answer: { action: string; target?: string; days?: number; value?: string; blocker?: string; into?: string; under?: string; epic?: boolean }, known: (key: string) => boolean): Intent | null {
  const a = answer.action;
  switch (a) {
    case "shift": {
      if (!answer.target || !known(answer.target)) return null;
      const days = Math.round(answer.days ?? 0);
      if (!days) return null;
      return { action: "shift", target: answer.target, days };
    }
    case "release": {
      if (!answer.target || !known(answer.target) || !answer.value) return null;
      return { action: "release", target: answer.target, value: answer.value };
    }
    case "lane": {
      if (!answer.target || !known(answer.target) || !answer.value) return null;
      return { action: "lane", target: answer.target, value: answer.value };
    }
    case "close": {
      if (!answer.target || !known(answer.target)) return null;
      return { action: "close", target: answer.target, reason: "COMPLETED" };
    }
    case "reopen": {
      if (!answer.target || !known(answer.target)) return null;
      return { action: "reopen", target: answer.target };
    }
    case "block": {
      if (!answer.target || !known(answer.target) || !answer.blocker || !known(answer.blocker)) return null;
      return { action: "block", target: answer.target, blocker: answer.blocker };
    }
    case "unblock": {
      if (!answer.target || !known(answer.target)) return null;
      return { action: "unblock", target: answer.target, blocker: answer.blocker ?? "" };
    }
    case "merge": {
      if (!answer.target || !known(answer.target) || !answer.into || !known(answer.into)) return null;
      return { action: "merge", target: answer.target, into: answer.into };
    }
    case "archive": {
      if (!answer.target || !known(answer.target)) return null;
      return { action: "archive", target: answer.target };
    }
    case "owner": {
      if (!answer.target || !known(answer.target) || !answer.value) return null;
      return { action: "owner", target: answer.target, value: answer.value };
    }
    case "create": {
      if (!answer.target) return null;
      return { action: "create", title: answer.target, under: answer.under, epic: answer.epic };
    }
    case "undo":
      return { action: "undo" };
    default:
      return null;
  }
}

/** Asks a model to read a sentence, and checks what it says. */
export async function readPhrase(settings: LocalSettings, phrase: string, keys: string[], releases: string[]): Promise<Intent | null> {
  const answer = await chatJson(settings, SYSTEM_PHRASE, promptPhrase(phrase, keys, releases), checkIntent).catch(() => null);
  if (!answer) return null;
  return toIntent(answer, k => keys.includes(k));
}

/** The items the model may name: the ones the phrase could mean. */
export function candidateKeys(project: Project, mapping: Mapping, phrase: string): string[] {
  return findTargets(project, mapping, phrase, 12).map(t => t.key);
}
