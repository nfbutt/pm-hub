// "Is it already here?" Before you write a new epic, does one already cover this?
//
// The input is a description, or a list of the pieces of work you have in mind. Each
// piece is compared with the stories of every epic, and the epics that already cover
// some of it come back — with the story that covers each piece, so you can see *why*.
import { isEpic, type Mapping } from "../mapping";
import type { Item, Project } from "../normalize";
import { stem, tokenize } from "../epicmap/text";
import { storiesOf } from "./compare";

/** One piece of work the person described. */
export interface InputItem {
  text: string;
}

export interface MatchedItem {
  /** What they said. */
  text: string;
  /** The story that already covers it, when one does. */
  story: string | null;
  storyKey: string | null;
  /** How well it matches, 0–1. */
  strength: number;
  /** The words both sides use. */
  shared: string[];
}

export interface EpicMatch {
  epic: Item;
  /** How much of the input this epic already covers, 0–1. */
  score: number;
  /** The pieces it covers. */
  covered: MatchedItem[];
  /** The pieces it does not. */
  missing: InputItem[];
}

/** Splits what someone typed into the pieces of work it describes. */
export function splitInput(input: string): InputItem[] {
  const lines = input.split(/\n+/).map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean);
  if (lines.length > 1) return lines.map(text => ({ text }));
  const sentences = input.split(/(?<=[.;!?])\s+/).map(s => s.trim()).filter(s => s.length > 3);
  return (sentences.length ? sentences : [input.trim()]).filter(Boolean).map(text => ({ text }));
}

/** The words of a piece of text, without the ones that say nothing. */
const words = (text: string) => new Set(tokenize(text).map(stem));

/** How much of one piece of work a story already covers, 0–1. */
function cover(item: string, story: Item): { strength: number; shared: string[] } {
  const a = words(item);
  if (!a.size) return { strength: 0, shared: [] };
  const b = words(`${story.title} ${story.body ?? ""}`);
  const shared: string[] = [];
  for (const w of a) if (b.has(w)) shared.push(w);
  // The story's own words count for less than the person's: a long story can cover a
  // short phrase by accident.
  const strength = Math.min(1, shared.length / Math.max(2, Math.min(a.size, 6)));
  return { strength, shared };
}

/** Below this, an epic is not worth showing. */
const MIN_MATCH = 0.2;

/**
 * The epics that already cover some of what was described, best first. The score is the
 * share of the input the epic accounts for, so an epic that covers two of three pieces
 * scores about two thirds.
 */
export function matchEpics(project: Project, mapping: Mapping, input: string, limit = 5): EpicMatch[] {
  const items = splitInput(input);
  if (!items.length) return [];
  const epics = project.items.filter(i => isEpic(i, mapping) && i.state === "open");
  const out: EpicMatch[] = [];
  for (const epic of epics) {
    const stories = storiesOf(project, epic);
    if (!stories.length) continue;
    const covered: MatchedItem[] = [];
    const missing: InputItem[] = [];
    let total = 0;
    for (const item of items) {
      let best: { story: Item; strength: number; shared: string[] } | null = null;
      for (const story of stories) {
        const c = cover(item.text, story);
        if (!best || c.strength > best.strength) best = { story, ...c };
      }
      if (best && best.strength >= MIN_MATCH) {
        total += best.strength;
        covered.push({ text: item.text, story: best.story.title, storyKey: best.story.key, strength: best.strength, shared: best.shared.slice(0, 5) });
      } else {
        missing.push(item);
      }
    }
    const score = total / items.length;
    if (score < MIN_MATCH) continue;
    out.push({ epic, score, covered, missing });
  }
  return out.sort((x, y) => y.score - x.score || y.covered.length - x.covered.length).slice(0, limit);
}

/** The title of an item, for a message. */
export const titleOf = (project: Project, key: string): string =>
  project.items.find(i => i.key === key)?.title ?? key;
