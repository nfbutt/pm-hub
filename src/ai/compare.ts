// Asking a model what two epics have in common, and what only one of them has. The
// answer is checked before it is shown: every claim has to come with the words it came
// from, and the words have to be really in the epics' stories. A claim that cannot be
// checked is dropped.
import { chatJson, type LocalSettings } from "./local";

export interface Claim {
  /** What is true, in one sentence. */
  text: string;
  /** The words it came from. */
  evidence: string;
}

export interface ComparisonAnswer {
  /** What each epic is for, in one line. */
  cover: { a: string; b: string };
  /** What they both do. */
  common: Claim[];
  /** What only one of them does. */
  different: Claim[];
}

export const SYSTEM_COMPARE = [
  "You compare two pieces of work and say what they have in common and what they do not.",
  "Every claim you make must come with the words you took it from, copied exactly.",
  "You answer with JSON only.",
].join(" ");

export interface EpicSummary {
  title: string;
  stories: { title: string; body: string }[];
}

/** The question, with the two epics and their stories. */
export function promptCompare(a: EpicSummary, b: EpicSummary): string {
  const side = (s: EpicSummary) => [
    `Epic: ${s.title}`,
    ...s.stories.map(st => `  - ${st.title}${st.body ? `: ${st.body}` : ""}`),
  ].join("\n");
  return [
    "Compare these two pieces of work.",
    "",
    side(a),
    "",
    side(b),
    "",
    'Answer with {"cover": {"a": "what the first is for", "b": "what the second is for"},',
    '"common": [{"text": "...", "evidence": "words copied from the stories"}],',
    '"different": [{"text": "...", "evidence": "words copied from the stories"}]}.',
    "Give at most four of each, and only say something you can point at.",
  ].join("\n");
}

/** Keeps only an answer that has the right shape. */
export function checkCompare(v: unknown): v is ComparisonAnswer {
  if (typeof v !== "object" || v === null) return false;
  const a = v as Partial<ComparisonAnswer>;
  if (typeof a.cover?.a !== "string" || typeof a.cover?.b !== "string") return false;
  if (!Array.isArray(a.common) || !Array.isArray(a.different)) return false;
  const claim = (c: unknown) => typeof c === "object" && c !== null
    && typeof (c as Claim).text === "string" && typeof (c as Claim).evidence === "string";
  return a.common.length <= 8 && a.different.length <= 8
    && a.common.every(claim) && a.different.every(claim);
}

/**
 * Asks the model to compare two epics. Any claim whose evidence cannot be found in the
 * stories is dropped: the reader has to be able to check it.
 */
export async function compareEpicsWithModel(
  settings: LocalSettings, a: EpicSummary, b: EpicSummary, found: (evidence: string) => boolean,
): Promise<ComparisonAnswer | null> {
  const answer = await chatJson(settings, SYSTEM_COMPARE, promptCompare(a, b), checkCompare).catch(() => null);
  if (!answer) return null;
  const keep = (claims: Claim[]) => claims.filter(c => found(c.evidence));
  const common = keep(answer.common), different = keep(answer.different);
  // If nothing can be checked, there is nothing worth saying.
  if (!common.length && !different.length) return null;
  return { cover: answer.cover, common, different };
}
