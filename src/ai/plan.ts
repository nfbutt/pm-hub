// Asking a model on this computer to draft a plan. The prompt gives it the project's own
// vocabulary — its epics, its releases, its labels — so the draft is written in terms the
// project can actually use, and the answer is checked before anyone sees it.
import type { PlanDraft } from "../model/plan/draft";

export interface PlanContext {
  /** The epics that exist today, so the draft does not repeat them. */
  epics: string[];
  /** The releases the project has. The draft may only use these. */
  releases: string[];
  /** The labels the project uses. */
  labels: string[];
  /** The people who could own the work. */
  people: string[];
  /** The date fields the project has. */
  startField: string | null;
  endField: string | null;
  /** Today's date, so the model starts from now. */
  today: string;
}

export const SYSTEM_PLAN = [
  "You plan projects. You write plans that fit the project you are given.",
  "You use only the releases and labels you are given, and you start from today's date.",
  "You answer with JSON only.",
].join(" ");

/** The question the user asked, with the project around it. */
export function promptPlan(ctx: PlanContext, description: string): string {
  return [
    "Here is the plan to write.",
    "",
    description.trim(),
    "",
    "The project today:",
    ctx.epics.length ? `- Epics that already exist: ${ctx.epics.join("; ")}` : "- It has no epics yet.",
    ctx.releases.length ? `- Releases you may use: ${ctx.releases.join(", ")}` : "- It has no releases, so leave the release empty.",
    ctx.labels.length ? `- Labels in use: ${ctx.labels.join(", ")}` : "",
    ctx.people.length ? `- People: ${ctx.people.join(", ")}` : "",
    `- Today is ${ctx.today}. A start date is not before today.`,
    ctx.startField && ctx.endField ? `- Dates go in the "${ctx.startField}" and "${ctx.endField}" fields.` : "- The project has no date fields, so leave the dates empty.",
    "",
    "Write the plan as a list of epics. Each epic has a title, a sentence saying what it is for,",
    "the release it belongs to (or null), a start and an end date (or null), a list of stories, and",
    'the titles of the epics that must be finished before it ("after").',
    "",
    'Answer with {"name": "...", "summary": "...", "epics": [{"title": "...", "why": "...", "release": null,',
    '"start": "2026-01-01", "end": "2026-02-01", "stories": [{"title": "...", "why": "...", "days": 3, "best": 2, "worst": 6}], "after": []}]}.',
    "Give every epic two to five stories, and keep the whole plan under forty pieces of work.",
    "For each story give three lengths in days: the optimistic one, the most likely one in \"days\", and the pessimistic one. Be honest about the worst case.",
  ].filter(Boolean).join("\n");
}

/** Keeps only an answer that is a plan: a name, and epics with titles and stories. */
export function checkPlan(v: unknown): v is PlanDraft {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Partial<PlanDraft>;
  if (!Array.isArray(d.epics) || d.epics.length > 40) return false;
  return d.epics.every(e => {
    if (typeof e !== "object" || e === null) return false;
    const epic = e as PlanDraft["epics"][number];
    if (typeof epic.title !== "string" || !epic.title.trim()) return false;
    if (epic.release !== null && typeof epic.release !== "string") return false;
    if (!Array.isArray(epic.stories)) return false;
    return epic.stories.every(s => typeof s === "object" && s !== null && typeof (s as { title?: unknown }).title === "string");
  });
}
