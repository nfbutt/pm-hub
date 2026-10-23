// What pm-hub asks a model about epics as a whole: which of them wait for which, and which
// release an epic belongs in. The answers are only shapes here; whether they hold up is
// decided in src/model/epiclinks.ts and src/model/releases.ts.
import type { ProposedEpicLink } from "../model/epiclinks";
import type { ProposedPlacement } from "../model/releases";

/** What the model is told about one epic. */
export interface EpicBrief {
  key: string;
  title: string;
  summary: string;
  stories: string[];
}

/** How much of each epic the model reads. Enough to quote from, little enough to stay fast. */
const SUMMARY_LIMIT = 280;
const STORY_LIMIT = 8;

export function briefOf(e: { key: string; title: string; body?: string | null }, stories: { title: string; body?: string | null }[]): EpicBrief {
  return {
    key: e.key, title: e.title,
    summary: (e.body ?? "").replace(/\s+/g, " ").trim().slice(0, SUMMARY_LIMIT),
    // A story's first sentence is where "after the API is live" usually is.
    stories: stories.slice(0, STORY_LIMIT).map(s => {
      const first = (s.body ?? "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
      return first ? `${s.title} — ${first.slice(0, 140)}` : s.title;
    }),
  };
}

export const SYSTEM_EPIC_LINKS = [
  "You read a plan made of epics and find which epics cannot start until another is finished.",
  "You only use the epic keys you are given.",
  "Every link needs a reason: words copied exactly from that epic, or from one of its stories, that show the dependency.",
  "Leave out anything you cannot quote. Answer with JSON only.",
].join(" ");

export function promptEpicLinks(epics: EpicBrief[], existing: { from: string; to: string }[]): string {
  return [
    "The epics:",
    ...epics.map(e => [
      `${e.key} | ${e.title}`,
      e.summary ? `  About: ${e.summary}` : "",
      ...e.stories.map(s => `  - ${s}`),
    ].filter(Boolean).join("\n")),
    "",
    existing.length ? `Links that are already there (do not repeat them): ${existing.map(l => `${l.from} -> ${l.to}`).join(", ")}` : "No links are there yet.",
    "",
    "Which epics have to wait for another? Look for an epic or a story that needs, uses, extends, or comes after the work of another epic.",
    "Answer with {\"links\": [{\"from\": \"<key of the epic that must finish first>\", \"to\": \"<key of the epic that waits>\", \"evidence\": \"<words copied exactly from either epic or their stories>\"}]}.",
    "Use no more than eight links.",
  ].join("\n");
}

export function checkEpicLinkAnswer(v: unknown): v is { links: ProposedEpicLink[] } {
  if (typeof v !== "object" || v === null) return false;
  const links = (v as { links?: unknown }).links;
  return Array.isArray(links) && links.length <= 16 && links.every(l => typeof l === "object" && l !== null
    && typeof (l as ProposedEpicLink).from === "string" && typeof (l as ProposedEpicLink).to === "string"
    && typeof (l as ProposedEpicLink).evidence === "string");
}

export const SYSTEM_PLACEMENT = [
  "You plan which release each epic ships in.",
  "You only use the releases and epic keys you are given, and you respect the order work has to happen in:",
  "an epic never ships before an epic it waits for. Answer with JSON only.",
].join(" ");

export interface PlacementBrief {
  releases: { title: string; due: string | null }[];
  epics: {
    key: string; title: string; release: string | null; finishes: string | null; waitsFor: string[];
    /** Why this one needs a decision; null when it is fine where it is. */
    problem: string | null;
    /** The releases it could go in without breaking the plan, worked out by pm-hub. */
    options: string[];
  }[];
  today: string;
}

/**
 * Asks about the epics that need a decision, each with the reason: a small model given
 * the whole plan tends to hand back every epic where it already is.
 */
export function promptPlacement(b: PlacementBrief): string {
  const line = (e: PlacementBrief["epics"][number]) =>
    `  ${e.key} | ${e.title} | ${e.release ? `in ${e.release}` : "in no release"}${e.finishes ? ` | finishes ${e.finishes}` : ""}${e.waitsFor.length ? ` | waits for ${e.waitsFor.join(", ")}` : ""}`;
  const decide = b.epics.filter(e => e.problem);
  const fixed = b.epics.filter(e => !e.problem);
  return [
    `Today is ${b.today}.`,
    "The releases, in the order they ship, and the epics already in each:",
    ...b.releases.map(r => {
      const holds = fixed.filter(e => e.release === r.title).map(e => e.title);
      return `  ${r.title}${r.due ? ` — due ${r.due}` : " — no date"}${holds.length ? `: ${holds.join("; ")}` : ""}`;
    }),
    "",
    "These epics need a release. For each, the reason, and the releases it can go in:",
    ...decide.map(e => `${line(e)}\n    needs: ${e.problem}\n    options: ${e.options.join(", ")}`),
    ...(fixed.length ? ["", "These are fine where they are, and are here so you know the order:", ...fixed.map(line)] : []),
    "",
    "For each epic that needs a release, choose one of its options: the one whose epics are about the same",
    "kind of work, so a release ships something whole. When none is closer than another, choose the first.",
    "Answer with {\"placements\": [{\"key\": \"<epic key>\", \"release\": \"<release title>\", \"why\": \"<one short sentence>\"}]}.",
  ].join("\n");
}

export function checkPlacementAnswer(v: unknown): v is { placements: ProposedPlacement[] } {
  if (typeof v !== "object" || v === null) return false;
  const list = (v as { placements?: unknown }).placements;
  return Array.isArray(list) && list.length <= 60 && list.every(p => typeof p === "object" && p !== null
    && typeof (p as ProposedPlacement).key === "string" && typeof (p as ProposedPlacement).release === "string");
}
