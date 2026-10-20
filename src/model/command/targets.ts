// Finding the thing someone means. "the API epic", "invoice screen", "#123", "the March
// release" — a phrase becomes a set of items, ranked. Pure, and deliberately type-aware:
// a word like "epic" says what kind of item is meant, and a number says exactly which.
import { isEpic, releaseOf, type Mapping } from "../mapping";
import type { Item, Project } from "../normalize";
import { stem, tokenize } from "../epicmap/text";

export type TargetKind = "epic" | "story";

export interface Target {
  key: string;
  title: string;
  kind: TargetKind;
  /** How well the phrase matched, 0–1. */
  score: number;
  /** The release it is in, when it is in one. */
  release: string | null;
}

/** Words that say what kind of item is meant. */
const TYPE_WORDS: Record<string, TargetKind> = {
  epic: "epic", epics: "epic",
  story: "story", stories: "story", task: "story", tasks: "story", issue: "story", issues: "story",
};

/** Words that carry no meaning in a phrase. */
const FILLER = new Set(["the", "a", "an", "my", "of", "to", "on", "in", "into", "under", "and", "that", "this", "please", "it", "its"]);

/** The phrase, broken into what it is asking for. */
export interface Parsed {
  /** The words that name the item. */
  words: string[];
  /** The kind of item it is, when the phrase says. */
  kind: TargetKind | null;
  /** The issue number it names, when it names one. */
  number: string | null;
  /** The release it says the item is in. */
  release: string | null;
}

export function parsePhrase(phrase: string): Parsed {
  const raw = phrase.toLowerCase().split(/[^a-z0-9#]+/).filter(Boolean);
  const words: string[] = [];
  let kind: TargetKind | null = null;
  let number: string | null = null;
  let release: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i]!;
    if (TYPE_WORDS[w]) { kind = TYPE_WORDS[w]!; continue; }
    if (/^#?\d+$/.test(w)) { number = w.replace("#", ""); continue; }
    if ((w === "release" || w === "version" || w === "iteration" || w === "sprint") && words.length) {
      // "in the March release": the words before it name it.
      release = words.pop()!;
      continue;
    }
    if (FILLER.has(w)) continue;
    words.push(w);
  }
  return { words, kind, number, release };
}

/** How well a phrase names an item, 0–1. */
function score(item: Item, parsed: Parsed, whole: string): number {
  if (parsed.number) return item.number === Number(parsed.number) ? 1 : 0;
  if (!parsed.words.length) return 0;
  const title = item.title.toLowerCase();
  if (title.includes(whole)) return 1;
  const tokens = new Set(tokenize(item.title).map(stem));
  let hits = 0;
  for (const w of parsed.words) if (tokens.has(stem(w))) hits++;
  if (!hits) return 0;
  // Every word matching is a full match; fewer is a partial one.
  return hits / parsed.words.length;
}

/**
 * The items a phrase could mean, best first. A phrase that names a number or a type is
 * exact; anything else is scored on the words.
 */
export function findTargets(project: Project, mapping: Mapping, phrase: string, limit = 8): Target[] {
  const parsed = parsePhrase(phrase);
  const whole = phrase.toLowerCase().trim();
  const out: Target[] = [];
  for (const item of project.items) {
    if (item.kind !== "issue" && item.kind !== "draft") continue;
    const kind: TargetKind = isEpic(item, mapping) ? "epic" : "story";
    if (parsed.kind && parsed.kind !== kind) continue;
    const s = score(item, parsed, whole);
    if (!s) continue;
    const release = releaseOf(item, mapping)?.title ?? null;
    if (parsed.release && !(release ?? "").toLowerCase().includes(parsed.release.toLowerCase())) continue;
    out.push({ key: item.key, title: item.title, kind, score: s, release });
  }
  // The best match first; a shorter title is more likely to be the one meant.
  return out.sort((a, b) => b.score - a.score || a.title.length - b.title.length).slice(0, limit);
}

/** The one item a phrase means, when there is only one. */
export function findOneTarget(project: Project, mapping: Mapping, phrase: string): Target | null {
  const found = findTargets(project, mapping, phrase, 2);
  if (found.length !== 1) return null;
  return found[0]!;
}
