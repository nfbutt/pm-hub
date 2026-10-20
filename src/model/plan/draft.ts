// A plan the model drafted, turned into changes. The draft is data: epics with their
// stories, their dates, their release and what has to happen first. Nothing here writes
// to GitHub; it produces ordinary operations, so the review screen can check them and
// undo can take them back. Pure.
import { milestoneOptions } from "../edits";
import type { Mapping } from "../mapping";
import type { FieldValue, Project } from "../normalize";
import { newKey, type Op } from "../ops";

export interface DraftStory {
  title: string;
  /** Why this piece of work is needed, in the model's words. */
  why: string;
  /** How long it is expected to take, in days. */
  days: number;
}

export interface DraftEpic {
  title: string;
  why: string;
  /** The release it belongs to, by name. */
  release: string | null;
  /** The dates, as ISO days. */
  start: string | null; end: string | null;
  stories: DraftStory[];
  /** The titles of the epics that have to be finished before this one. */
  after: string[];
}

export interface PlanDraft {
  /** What the plan is called. */
  name: string;
  summary: string;
  epics: DraftEpic[];
}

/** The most pieces of work one draft may add. More than this and it is not a plan. */
export const MAX_DRAFT_ITEMS = 60;

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * The checks a draft has to pass: real releases, sensible dates, no empty titles, and a
 * number of pieces of work that could actually be reviewed. What fails is dropped, and
 * the reasons are kept so the user can see what was left out.
 */
export function checkDraft(project: Project, mapping: Mapping, draft: PlanDraft): { draft: PlanDraft; problems: string[] } {
  const problems: string[] = [];
  const releases = new Set<string>();
  if (mapping.release.kind === "field") {
    const field = mapping.release.field;
    const f = project.fields.find(x => x.name === field);
    if (f?.kind === "single") for (const o of f.options) releases.add(o.name);
  } else if (mapping.release.kind === "milestone") {
    for (const m of milestoneOptions(project)) releases.add(m.title);
  }

  const seen = new Set<string>();
  const epics: DraftEpic[] = [];
  for (const e of draft.epics ?? []) {
    const title = (e.title ?? "").trim();
    if (!title) { problems.push("An epic with no name was left out."); continue; }
    if (seen.has(title)) { problems.push(`“${title}” was listed twice; the second one was left out.`); continue; }
    seen.add(title);

    let release = e.release?.trim() || null;
    if (release && !releases.has(release)) {
      problems.push(`“${title}” was put in “${release}”, which is not a release in this project. It was left out.`);
      release = null;
    }
    let start = isDay(e.start) ? e.start : null;
    let end = isDay(e.end) ? e.end : null;
    if (start && end && end < start) { problems.push(`“${title}” ends before it starts. Its dates were left out.`); start = null; end = null; }
    if (start && !end) { end = start; }
    if (end && !start) { start = end; }

    const stories: DraftStory[] = [];
    for (const s of e.stories ?? []) {
      const st = (s.title ?? "").trim();
      if (!st) continue;
      const days = Number.isFinite(s.days) ? Math.max(1, Math.min(90, Math.round(s.days))) : 1;
      stories.push({ title: st, why: (s.why ?? "").trim(), days });
    }
    epics.push({ title, why: (e.why ?? "").trim(), release, start, end, stories, after: e.after ?? [] });
  }

  // The dependencies have to point at epics that are in the draft.
  const titles = new Set(epics.map(e => e.title));
  for (const e of epics) {
    e.after = e.after.filter(t => titles.has(t) && t !== e.title);
  }

  let items = epics.length + epics.reduce((s, e) => s + e.stories.length, 0);
  if (items > MAX_DRAFT_ITEMS) {
    problems.push(`This plan had ${items} pieces of work. Only the first ${MAX_DRAFT_ITEMS} were kept, because a plan that big cannot be read.`);
    const kept: DraftEpic[] = [];
    let room = MAX_DRAFT_ITEMS;
    for (const e of epics) {
      const cost = 1 + e.stories.length;
      if (cost <= room) { kept.push(e); room -= cost; continue; }
      // The epic still fits, but only some of its stories do.
      const stories = e.stories.slice(0, Math.max(0, room - 1));
      if (stories.length) { kept.push({ ...e, stories }); room -= 1 + stories.length; }
    }
    epics.length = 0;
    epics.push(...kept);
    items = epics.length + epics.reduce((s, e) => s + e.stories.length, 0);
  }

  return { draft: { name: (draft.name ?? "").trim() || "New plan", summary: (draft.summary ?? "").trim(), epics }, problems };
}

/** The story label the project uses, so new work is marked the same way as the old. */
function storyLabel(project: Project, mapping: Mapping): string | null {
  const found = project.items.flatMap(i => i.labels).find(l => /^(type|kind)\s*:\s*(story|task)$/i.test(l));
  return found && found !== mapping.epic.label ? found : null;
}

/**
 * The operations that turn a draft into changes: the epics, their stories, their dates
 * and their release, and the links between them. One list, so it undoes as one change.
 */
export function draftOps(project: Project, mapping: Mapping, draft: PlanDraft): Op[] {
  const repo = project.items.find(i => i.repo)?.repo ?? null;
  const epicLabel = mapping.epic.label;
  const story = storyLabel(project, mapping);
  const ops: Op[] = [];

  // Every epic gets its key first, so a story can point at the epic it belongs to and
  // a dependency can point at another epic in the same draft.
  const keys = new Map<string, string>();
  for (const e of draft.epics) keys.set(e.title, newKey());

  const dateFields = { start: mapping.startField, end: mapping.endField };
  const releaseField = mapping.release.kind === "field" ? mapping.release.field : null;

  for (const e of draft.epics) {
    const fields: Record<string, FieldValue> = {};
    if (e.start && dateFields.start) fields[dateFields.start] = { kind: "date", date: e.start };
    if (e.end && dateFields.end) fields[dateFields.end] = { kind: "date", date: e.end };
    if (e.release && releaseField) {
      const f = project.fields.find(x => x.name === releaseField);
      const opt = f?.kind === "single" ? f.options.find(o => o.name === e.release) : undefined;
      if (opt) fields[releaseField] = { kind: "single", name: opt.name, optionId: opt.id };
    }
    const key = keys.get(e.title)!;
    ops.push({ kind: "create", key, item: { title: e.title, repo, parentKey: null, labels: epicLabel ? [epicLabel] : [], fields } });

    // A release that is a milestone cannot be a field value, so it is set afterwards.
    if (e.release && mapping.release.kind === "milestone") {
      const ms = milestoneOptions(project).find(m => m.title === e.release);
      if (ms) ops.push({ kind: "setMilestone", key, before: null, after: ms });
    }

    for (const s of e.stories) {
      const sFields: Record<string, FieldValue> = {};
      // A story runs inside the epic's window, unless the epic has no dates.
      if (e.start && dateFields.start) sFields[dateFields.start] = { kind: "date", date: e.start };
      if (e.start && dateFields.end) sFields[dateFields.end] = { kind: "date", date: addDays(e.start, s.days - 1) };
      ops.push({ kind: "create", key: newKey(), item: { title: s.title, repo, parentKey: key, labels: story ? [story] : [], fields: sFields } });
    }
  }

  // What has to happen first.
  for (const e of draft.epics) {
    const blocked = keys.get(e.title);
    if (!blocked) continue;
    for (const after of e.after) {
      const blocker = keys.get(after);
      if (blocker) ops.push({ kind: "addBlockedBy", key: blocked, blocker });
    }
  }
  return ops;
}

/** A day after another, as an ISO day. */
function addDays(day: string, days: number): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** What a draft adds, for the line the user reads before agreeing to it. */
export interface DraftSummary {
  epics: number; stories: number; links: number;
  /** The first and last day the plan covers. */
  from: string | null; to: string | null;
  releases: string[];
}

export function summariseDraft(draft: PlanDraft): DraftSummary {
  const stories = draft.epics.reduce((s, e) => s + e.stories.length, 0);
  const links = draft.epics.reduce((s, e) => s + e.after.length, 0);
  const starts = draft.epics.map(e => e.start).filter((d): d is string => !!d).sort();
  const ends = draft.epics.map(e => e.end).filter((d): d is string => !!d).sort();
  return {
    epics: draft.epics.length, stories, links,
    from: starts[0] ?? null, to: ends[ends.length - 1] ?? null,
    releases: [...new Set(draft.epics.map(e => e.release).filter((r): r is string => !!r))],
  };
}
