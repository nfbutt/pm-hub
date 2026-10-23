// Releases as a plan of epics. A release holds epics, not stories: an epic ships when its
// work ships, so putting an epic in a release puts its open work there with it. This file
// works out what the releases are, which epics are in each, whether each release can make
// its date, and the changes that make or move a release. Pure: views render it and record
// the ops it returns.
import { setField, setMilestone, setOption } from "./edits";
import { isEpic, releaseOf, type Mapping } from "./mapping";
import type { Item, Milestone, Project } from "./normalize";
import type { MilestoneSpec, Op } from "./ops";
import type { Plan } from "./plan/cpm";
import type { Schedule } from "./schedule";

export interface ReleaseInfo {
  /** Stable for the life of the release: its title for milestones, the option or iteration id otherwise. */
  id: string;
  title: string;
  due: string | null;
  start: string | null;
  /** For milestones: the repositories the release exists in. */
  repos: string[];
  /** Closed on GitHub: kept so the work in it still has a home on the board. */
  closed: boolean;
}

export interface ReleaseEpic {
  key: string;
  title: string;
  open: boolean;
  /** True when the epic itself is in the release; false when it is there because most of its work is. */
  own: boolean;
  /** Its stories: how many, how many are done, and how many open ones are in a different release. */
  total: number;
  done: number;
  elsewhere: number;
  /** When the epic is planned to finish. */
  end: string | null;
  /** It finishes after its release is due. */
  late: boolean;
  /** Epics this one waits for that ship in a later release, or in none. */
  waitsFor: { key: string; title: string; release: string | null }[];
}

export type ReleaseStatus = "done" | "overdue" | "at-risk" | "on-track" | "no-date" | "empty";

export interface ReleaseColumn {
  /** Null is the column of epics that are in no release yet. */
  release: ReleaseInfo | null;
  epics: ReleaseEpic[];
  /** Stories in the release's epics, and how many are done. */
  total: number;
  done: number;
  /** The last planned finish of its open epics. */
  finish: string | null;
  status: ReleaseStatus;
}

export type ReleaseProblemKind = "order" | "late" | "split" | "unplanned";

export interface ReleaseProblem {
  kind: ReleaseProblemKind;
  keys: string[];
  message: string;
  /** A change that fixes it, when there is an obvious one. */
  fix?: { label: string; ops: Op[] };
}

export interface ReleaseBoard {
  columns: ReleaseColumn[];
  problems: ReleaseProblem[];
}

/** What can be changed about releases in this project, and why not when it cannot. */
export interface ReleaseAbilities {
  create: boolean;
  date: boolean;
  why: string | null;
}

// ---------------------------------------------------------------- what the releases are

/** Every release the project has, in the order they are due. */
export function listReleases(project: Project, mapping: Mapping): ReleaseInfo[] {
  const rule = mapping.release;
  if (rule.kind === "milestone") {
    const byTitle = new Map<string, { ms: Milestone[] }>();
    const add = (m: Milestone) => {
      const entry = byTitle.get(m.title) ?? { ms: [] };
      if (!entry.ms.some(x => x.repo === m.repo)) entry.ms.push(m);
      byTitle.set(m.title, entry);
    };
    for (const m of project.milestones ?? []) add(m);
    for (const i of project.items) if (i.milestone) add(i.milestone);
    return sortByDue([...byTitle.entries()].map(([title, { ms }]) => ({
      id: title, title,
      due: ms.map(m => m.dueOn?.slice(0, 10) ?? null).filter((d): d is string => !!d).sort()[0] ?? null,
      start: null,
      repos: ms.map(m => m.repo).sort(),
      closed: ms.every(m => m.state.toUpperCase() === "CLOSED"),
    })));
  }
  if (rule.kind === "field") {
    const def = project.fields.find(f => f.name === rule.field);
    if (def?.kind !== "single") return [];
    return sortByDue(def.options.map(o => ({
      id: `f:${o.id}`, title: o.name, due: dueFromItems(project, mapping, o.name), start: null, repos: [], closed: false,
    })));
  }
  if (rule.kind === "iteration") {
    const def = project.fields.find(f => f.name === rule.field);
    if (def?.kind !== "iteration") return [];
    return def.iterations.map(it => ({
      id: `i:${it.id}`, title: it.title, start: it.startDate, due: addDays(it.startDate, it.duration - 1), repos: [], closed: it.completed,
    }));
  }
  return [];
}

/** A field-based release's due date: the one most of its items carry. */
function dueFromItems(project: Project, mapping: Mapping, title: string): string | null {
  const tally = new Map<string, number>();
  for (const i of project.items) {
    const r = releaseOf(i, mapping);
    if (r?.title === title && r.due) tally.set(r.due, (tally.get(r.due) ?? 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

const sortByDue = (list: ReleaseInfo[]) => list.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.title.localeCompare(b.title));

function addDays(iso: string, days: number): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** What pm-hub can change about this project's releases. */
export function releaseAbilities(mapping: Mapping): ReleaseAbilities {
  switch (mapping.release.kind) {
    case "milestone": return { create: true, date: true, why: null };
    case "field": return {
      create: false, date: !!mapping.releaseDueField,
      why: mapping.releaseDueField
        ? "Releases here are the options of a field. Add an option in the project's settings on GitHub, then refresh."
        : "Releases here are the options of a field, which has no due date. Pick the field that holds release dates in Settings to set them here.",
    };
    case "iteration": return { create: false, date: false, why: "Releases here are iterations: their dates are set in the project's settings on GitHub." };
    default: return { create: false, date: false, why: "This project has no releases set up. Pick milestones or a field in Settings." };
  }
}

/** The repositories a new release can be made in: the ones the project's issues live in. */
export function releaseRepos(project: Project): string[] {
  return [...new Set(project.items.map(i => i.repo).filter((r): r is string => !!r))].sort();
}

// ---------------------------------------------------------------- the board

/** The work of an epic: every item whose nearest epic ancestor is it. */
export function workOf(project: Project, mapping: Mapping, epic: Item, byKey = new Map(project.items.map(i => [i.key, i]))): Item[] {
  const out: Item[] = [];
  for (const item of project.items) {
    if (item.key === epic.key || isEpic(item, mapping)) continue;
    const seen = new Set<string>();
    for (let k = item.parentKey; k && !seen.has(k); k = byKey.get(k)?.parentKey ?? null) {
      seen.add(k);
      if (k === epic.key) { out.push(item); break; }
      const p = byKey.get(k);
      if (!p || isEpic(p, mapping)) break;
    }
  }
  return out;
}

/** The release an epic is in: its own, or the one most of its open work is in. */
export function epicRelease(project: Project, mapping: Mapping, epic: Item, work?: Item[]): { title: string; own: boolean } | null {
  const own = releaseOf(epic, mapping);
  if (own) return { title: own.title, own: true };
  const tally = new Map<string, number>();
  for (const w of work ?? workOf(project, mapping, epic)) {
    if (w.state !== "open") continue;
    const r = releaseOf(w, mapping);
    if (r) tally.set(r.title, (tally.get(r.title) ?? 0) + 1);
  }
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best ? { title: best[0], own: false } : null;
}

/**
 * The releases as columns of epics, each with how far along it is and whether it can
 * make its date, plus what is wrong with the release plan as it stands.
 */
export function releaseBoard(project: Project, mapping: Mapping, schedule: Schedule, plan: Plan, today: string): ReleaseBoard {
  const byKey = new Map(project.items.map(i => [i.key, i]));
  const releases = listReleases(project, mapping);
  const order = new Map(releases.map((r, i) => [r.title, i]));
  const epics = project.items.filter(i => isEpic(i, mapping));

  const placed = new Map<string, { title: string; own: boolean } | null>();
  const work = new Map<string, Item[]>();
  for (const e of epics) {
    const w = workOf(project, mapping, e, byKey);
    work.set(e.key, w);
    placed.set(e.key, epicRelease(project, mapping, e, w));
  }

  const releaseByTitle = new Map(releases.map(r => [r.title, r]));
  const make = (e: Item): ReleaseEpic => {
    const w = work.get(e.key) ?? [];
    const rel = placed.get(e.key) ?? null;
    const due = rel ? releaseByTitle.get(rel.title)?.due ?? null : null;
    const end = schedule.bars.get(e.key)?.end ?? null;
    const relIndex = rel ? order.get(rel.title) ?? -1 : -1;
    const waitsFor = plan.links.filter(l => l.to === e.key).flatMap(l => {
      const blocker = byKey.get(l.from);
      if (!blocker || blocker.state !== "open") return [];
      const theirs = placed.get(blocker.key) ?? null;
      const theirIndex = theirs ? order.get(theirs.title) ?? -1 : -1;
      // A blocker in a later release, or in none, means this epic cannot ship when it says.
      return rel && (theirIndex < 0 || theirIndex > relIndex) ? [{ key: blocker.key, title: blocker.title, release: theirs?.title ?? null }] : [];
    });
    return {
      key: e.key, title: e.title, open: e.state === "open", own: rel?.own ?? false,
      total: w.length, done: w.filter(x => x.state !== "open").length,
      elsewhere: rel ? w.filter(x => x.state === "open" && (releaseOf(x, mapping)?.title ?? rel.title) !== rel.title).length : 0,
      end, late: !!(e.state === "open" && due && end && end > due),
      waitsFor,
    };
  };

  const columns: ReleaseColumn[] = releases.map(r => ({ release: r, epics: [], total: 0, done: 0, finish: null, status: "empty" }));
  const none: ReleaseColumn = { release: null, epics: [], total: 0, done: 0, finish: null, status: "empty" };
  const columnFor = new Map(columns.map(c => [c.release!.title, c]));
  for (const e of epics) {
    const rel = placed.get(e.key);
    const col = rel ? columnFor.get(rel.title) : none;
    // An epic that is finished and in no release is history, not a plan.
    if (!col || (!rel && e.state !== "open")) continue;
    col.epics.push(make(e));
  }
  for (const c of [...columns, none]) {
    c.epics.sort((a, b) => Number(!a.open) - Number(!b.open) || (a.end ?? "9999").localeCompare(b.end ?? "9999") || a.title.localeCompare(b.title));
    c.total = c.epics.reduce((n, e) => n + e.total, 0);
    c.done = c.epics.reduce((n, e) => n + e.done, 0);
    c.finish = c.epics.filter(e => e.open && e.end).map(e => e.end!).sort().pop() ?? null;
    c.status = statusOf(c, today);
  }

  const problems: ReleaseProblem[] = [];
  for (const c of columns) for (const e of c.epics) {
    if (!e.open) continue;
    for (const w of e.waitsFor) {
      const item = byKey.get(e.key)!;
      const later = w.release ? fittingReleases(project, mapping, plan, item).find(r => r.title !== c.release!.title) ?? null : null;
      problems.push({
        kind: "order", keys: [e.key, w.key],
        message: (w.release
          ? `“${e.title}” ships in ${c.release!.title} but waits for “${w.title}”, which ships later, in ${w.release}.`
          : `“${e.title}” ships in ${c.release!.title} but waits for “${w.title}”, which is in no release.`)
          + (w.release && !later ? " No release fits it without moving something else too." : ""),
        fix: later ? { label: `Move “${e.title}” to ${later.title}`, ops: moveEpicToRelease(project, mapping, item, later) } : undefined,
      });
    }
    if (e.late) {
      const item = byKey.get(e.key)!;
      // The first release due late enough, and in the right order — not just the next one.
      const fit = fittingReleases(project, mapping, plan, item).find(r => r.title !== c.release!.title) ?? null;
      problems.push({
        kind: "late", keys: [e.key],
        message: `“${e.title}” is planned to finish ${e.end}, after ${c.release!.title} is due (${c.release!.due}).${fit ? "" : ` No release is due late enough: make one due after ${e.end}.`}`,
        fix: fit ? { label: `Move it to ${fit.title}`, ops: moveEpicToRelease(project, mapping, item, fit) } : undefined,
      });
    }
    if (e.elsewhere > 0) {
      const item = byKey.get(e.key)!;
      problems.push({
        kind: "split", keys: [e.key],
        message: `${e.elsewhere} open ${e.elsewhere === 1 ? "story" : "stories"} of “${e.title}” ${e.elsewhere === 1 ? "is" : "are"} in a different release from the epic.`,
        fix: { label: `Bring ${e.elsewhere === 1 ? "it" : "them"} into ${c.release!.title}`, ops: moveEpicToRelease(project, mapping, item, c.release!, { allStories: true }) },
      });
    }
  }
  const unplanned = none.epics.filter(e => e.open);
  if (unplanned.length && releases.length) {
    if (unplanned.length <= 8) {
      for (const e of unplanned) {
        const item = byKey.get(e.key)!;
        const fit = fittingReleases(project, mapping, plan, item)[0] ?? null;
        problems.push({
          kind: "unplanned", keys: [e.key],
          message: `“${e.title}” is in no release.${e.end ? ` It is planned to finish ${e.end}.` : ""}`,
          fix: fit ? { label: `Put it in ${fit.title}`, ops: moveEpicToRelease(project, mapping, item, fit) } : undefined,
        });
      }
    } else {
      problems.push({
        kind: "unplanned", keys: unplanned.map(e => e.key),
        message: `${unplanned.length} open epics are in no release.`,
      });
    }
  }
  return { columns: [...columns, none], problems };
}

function statusOf(c: ReleaseColumn, today: string): ReleaseStatus {
  const open = c.epics.filter(e => e.open);
  if (!c.epics.length) return "empty";
  if (!open.length) return "done";
  const due = c.release?.due ?? null;
  if (!due) return "no-date";
  if (due < today) return "overdue";
  if (open.some(e => e.late || e.waitsFor.length)) return "at-risk";
  return "on-track";
}

// ---------------------------------------------------------------- changes

/** The milestone a release is in a repository, if it is there yet. */
function milestoneIn(project: Project, title: string, repo: string | null): Milestone | null {
  if (!repo) return null;
  const known = [...(project.milestones ?? []), ...project.items.map(i => i.milestone).filter((m): m is Milestone => !!m)];
  return known.find(m => m.title === title && m.repo === repo) ?? null;
}

/**
 * Puts an epic in a release, and its open work with it: the stories that were in the epic's
 * old release, or in none. A story deliberately put in some other release is left there,
 * unless `allStories` says otherwise. Null takes the epic out of every release.
 *
 * With milestones, a release lives in one repository at a time, so a story in a repository
 * the release is not in yet makes the release there too, in the same change.
 */
export function moveEpicToRelease(project: Project, mapping: Mapping, epic: Item, release: ReleaseInfo | null, opts: { allStories?: boolean } = {}): Op[] {
  const before = epicRelease(project, mapping, epic)?.title ?? null;
  const work = workOf(project, mapping, epic).filter(w => w.state === "open");
  const follows = work.filter(w => {
    if (opts.allStories) return true;
    const r = releaseOf(w, mapping)?.title ?? null;
    return r === null || r === before;
  });
  const ops: Op[] = [];
  const made = new Set<string>();
  for (const item of [epic, ...follows]) {
    if (item.kind === "draft" && mapping.release.kind === "milestone") continue;
    ops.push(...placeItem(project, mapping, item, release, made, ops));
  }
  return ops;
}

function placeItem(project: Project, mapping: Mapping, item: Item, release: ReleaseInfo | null, made: Set<string>, ops: Op[]): Op[] {
  const rule = mapping.release;
  if (rule.kind === "milestone") {
    if (!release) return item.milestone ? setMilestone(item, null) : [];
    if (item.milestone?.title === release.title) return [];
    let ms = milestoneIn(project, release.title, item.repo);
    if (!ms && item.repo) {
      // The release is not in this repository yet: make it there, once.
      if (!made.has(item.repo)) {
        made.add(item.repo);
        ops.push({ kind: "milestone", ref: `${item.repo}#${release.title}`, repo: item.repo, before: null, after: { title: release.title, dueOn: release.due, state: "open" } });
      }
      ms = { id: null, title: release.title, number: 0, dueOn: release.due, state: "OPEN", repo: item.repo };
    }
    return ms ? setMilestone(item, ms) : [];
  }
  if (rule.kind === "field") return setOption(project, item, rule.field, release?.title ?? null);
  if (rule.kind === "iteration") {
    const def = project.fields.find(f => f.name === rule.field);
    if (def?.kind !== "iteration") return [];
    if (!release) return setField(item, rule.field, null);
    const it = def.iterations.find(x => `i:${x.id}` === release.id);
    return it ? setField(item, rule.field, { kind: "iteration", title: it.title, startDate: it.startDate, duration: it.duration, iterationId: it.id }) : [];
  }
  return [];
}

/** A new release, due on a day, made in each repository named. Milestones only. */
export function createRelease(project: Project, mapping: Mapping, title: string, due: string | null, repos: string[]): Op[] {
  const name = title.trim();
  if (mapping.release.kind !== "milestone" || !name) return [];
  return repos
    .filter(repo => !milestoneIn(project, name, repo))
    .map(repo => ({ kind: "milestone" as const, ref: `${repo}#${name}`, repo, before: null, after: { title: name, dueOn: due, state: "open" as const } }));
}

/**
 * Moves a release's due date. A milestone release changes in every repository it is in;
 * a field-based one changes the date on everything in it.
 */
export function setReleaseDue(project: Project, mapping: Mapping, release: ReleaseInfo, due: string | null): Op[] {
  const rule = mapping.release;
  if (rule.kind === "milestone") {
    return release.repos.flatMap(repo => {
      const ms = milestoneIn(project, release.title, repo);
      if (!ms) return [];
      const spec: MilestoneSpec = { title: ms.title, dueOn: ms.dueOn?.slice(0, 10) ?? null, state: "open" };
      if (spec.dueOn === due) return [];
      return [{ kind: "milestone" as const, ref: `${repo}#${ms.title}`, repo, before: spec, after: { ...spec, dueOn: due } }];
    });
  }
  if (rule.kind === "field" && mapping.releaseDueField) {
    const field = mapping.releaseDueField;
    return project.items
      .filter(i => releaseOf(i, mapping)?.title === release.title)
      .flatMap(i => setField(i, field, due ? { kind: "date", date: due } : null));
  }
  return [];
}

/**
 * The open releases an epic could ship in without breaking the plan: due on or after the
 * day it finishes, no earlier than the release of anything it waits for, and no later
 * than the release of anything that waits for it. In the order they are due.
 */
export function fittingReleases(project: Project, mapping: Mapping, plan: Plan, epic: Item): ReleaseInfo[] {
  const byKey = new Map(project.items.map(i => [i.key, i]));
  const releases = listReleases(project, mapping).filter(r => !r.closed);
  const order = new Map(releases.map((r, i) => [r.title, i]));
  const indexOf = (key: string) => { const e = byKey.get(key); const r = e ? epicRelease(project, mapping, e) : null; return r ? order.get(r.title) ?? null : null; };
  const known = (list: (number | null)[]) => list.filter((i): i is number => i !== null);
  const notBefore = Math.max(-1, ...known(plan.links.filter(l => l.to === epic.key).map(l => indexOf(l.from))));
  const notAfter = Math.min(Infinity, ...known(plan.links.filter(l => l.from === epic.key).map(l => indexOf(l.to))));
  const end = plan.epics.get(epic.key)?.end ?? null;
  return releases.filter((r, i) => i >= notBefore && i <= notAfter && (!end || !r.due || r.due >= end));
}

// ---------------------------------------------------------------- a model's placements

/** What a model said about where an epic belongs. */
export interface ProposedPlacement { key: string; release: string; why: string }

export interface PlacementSuggestion {
  id: string;
  key: string;
  title: string;
  release: string;
  why: string;
  ops: Op[];
}

/**
 * Keeps the placements that make sense: a real open epic, a release the project has, a
 * different one from where it is, and one that respects the dependencies — not before
 * anything it waits for, and not after anything that waits for it.
 */
export function checkPlacements(project: Project, mapping: Mapping, plan: Plan, proposed: ProposedPlacement[]): { accepted: PlacementSuggestion[]; dropped: { proposed: ProposedPlacement; reason: string }[] } {
  const byKey = new Map(project.items.map(i => [i.key, i]));
  const releases = listReleases(project, mapping).filter(r => !r.closed);
  const order = new Map(releases.map((r, i) => [r.title, i]));
  const accepted: PlacementSuggestion[] = [];
  const dropped: { proposed: ProposedPlacement; reason: string }[] = [];
  const seen = new Set<string>();
  const indexOf = (key: string) => { const e = byKey.get(key); const r = e ? epicRelease(project, mapping, e) : null; return r ? order.get(r.title) ?? null : null; };

  for (const p of proposed) {
    const epic = byKey.get(p.key);
    if (!epic || !isEpic(epic, mapping)) { dropped.push({ proposed: p, reason: "that is not an epic in this project" }); continue; }
    if (epic.state !== "open") { dropped.push({ proposed: p, reason: "that epic is already closed" }); continue; }
    const target = releases.find(r => r.title === p.release?.trim());
    if (!target) { dropped.push({ proposed: p, reason: `${p.release} is not an open release in this project` }); continue; }
    // Leaving an epic where it is is not a wrong answer, just not a change.
    if (epicRelease(project, mapping, epic)?.title === target.title) continue;
    const at = order.get(target.title)!;
    const blockers = plan.links.filter(l => l.to === epic.key).map(l => indexOf(l.from)).filter((i): i is number => i !== null);
    if (blockers.some(i => i > at)) { dropped.push({ proposed: p, reason: "something it waits for ships later than that" }); continue; }
    const waiting = plan.links.filter(l => l.from === epic.key).map(l => indexOf(l.to)).filter((i): i is number => i !== null);
    if (waiting.some(i => i < at)) { dropped.push({ proposed: p, reason: "something that waits for it ships earlier than that" }); continue; }
    const end = plan.epics.get(epic.key)?.end ?? null;
    if (end && target.due && end > target.due) { dropped.push({ proposed: p, reason: "it is planned to finish after that release is due" }); continue; }
    if (seen.has(epic.key)) continue;
    seen.add(epic.key);
    const ops = moveEpicToRelease(project, mapping, epic, target);
    if (!ops.length) { dropped.push({ proposed: p, reason: "the release cannot be set on it" }); continue; }
    accepted.push({ id: `place:${epic.key}:${target.title}`, key: epic.key, title: epic.title, release: target.title, why: (p.why ?? "").trim(), ops });
  }
  return { accepted, dropped };
}
