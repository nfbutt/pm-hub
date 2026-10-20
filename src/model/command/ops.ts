// An intention becomes operations. Everything here goes through the same helpers the
// mouse uses, so a spoken command is a recorded change like any other: it undoes the
// same way, and it is checked against GitHub the same way before anything is written.
import {
  addBlocker, epicOptions, laneOptions, milestoneOptions, moveToParent, newItem, peopleOptions,
  removeBlocker, setAssignees, setLane, setRelease, setState, shiftDates,
} from "../edits";
import { isEpic, type Mapping } from "../mapping";
import type { Item, Project } from "../normalize";
import type { Op } from "../ops";
import type { Intent } from "./intent";
import { findTargets, type Target } from "./targets";

export interface CommandResult {
  /** The changes to record. Empty when nothing could be worked out. */
  ops: Op[];
  /** What to tell the person. */
  label: string;
  /** The item the command was about, when it worked out. */
  target?: Target;
  /** What still has to be worked out. */
  question?: string;
  /** The item the command was about, when it is an epic being merged. */
  second?: Target;
}

/** Folds one epic into another: the children move across, the smaller epic is removed. */
export function mergeEpics(project: Project, into: Item, from: Item): Op[] {
  if (into.key === from.key) return [];
  const ops: Op[] = [];
  for (const child of project.items.filter(i => i.parentKey === from.key)) {
    ops.push(...moveToParent(project, child, into.key));
  }
  // Anything under the epic that is not a direct child moves across as well.
  for (const item of project.items) {
    if (item.parentKey === into.key || item.parentKey === from.key) continue;
    let parent = item.parentKey;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      if (parent === from.key) { ops.push(...moveToParent(project, item, into.key)); break; }
      parent = project.items.find(i => i.key === parent)?.parentKey ?? null;
    }
  }
  ops.push({ kind: "archive", key: from.key });
  return ops;
}

/** The one item a phrase means, or the question to ask. */
function resolve(project: Project, mapping: Mapping, phrase: string, question: string): { target?: Target; question?: string } {
  const found = findTargets(project, mapping, phrase);
  if (found.length === 1) return { target: found[0]! };
  if (found.length > 1) return { question: `Which one? ${found.slice(0, 4).map(t => t.title).join(", ")}` };
  return { question };
}

/**
 * The changes a command makes. When the phrase was not enough, the result carries the
 * question to ask instead of a guess.
 */
export function intentOps(project: Project, mapping: Mapping, intent: Intent): CommandResult {
  const byKey = new Map(project.items.map(i => [i.key, i]));
  switch (intent.action) {
    case "undo":
      return { ops: [], label: "Undo" };

    case "shift": {
      const { target, question } = resolve(project, mapping, intent.target, "Which item should move?");
      if (!target) return { ops: [], label: "Move an item", question };
      const item = byKey.get(target.key)!;
      const days = intent.days;
      const ops = shiftDates(project, mapping, [item.key], days);
      return {
        ops, target,
        label: `Moved ${item.title} ${days > 0 ? `${days} days later` : `${Math.abs(days)} days earlier`}`,
      };
    }

    case "release": {
      const { target, question } = resolve(project, mapping, intent.target, "Which item?");
      if (!target) return { ops: [], label: "Set a release", question };
      const item = byKey.get(target.key)!;
      const ops = setRelease(project, mapping, item, intent.value);
      if (!ops.length) return { ops: [], label: "Set a release", question: `There is no release called “${intent.value}”` };
      return { ops, target, label: `Put ${item.title} in ${intent.value}` };
    }

    case "lane": {
      const { target, question } = resolve(project, mapping, intent.target, "Which item?");
      if (!target) return { ops: [], label: "Move to a lane", question };
      const item = byKey.get(target.key)!;
      const ops = setLane(project, mapping, item, intent.value);
      if (!ops.length) return { ops: [], label: "Move to a lane", question: `There is no lane called “${intent.value}”` };
      return { ops, target, label: `Moved ${item.title} to ${intent.value}` };
    }

    case "close": {
      const { target, question } = resolve(project, mapping, intent.target, "Which item?");
      if (!target) return { ops: [], label: "Close an item", question };
      const item = byKey.get(target.key)!;
      return { ops: setState(item, "closed", intent.reason), target, label: `Closed ${item.title}` };
    }

    case "reopen": {
      const { target, question } = resolve(project, mapping, intent.target, "Which item?");
      if (!target) return { ops: [], label: "Reopen an item", question };
      const item = byKey.get(target.key)!;
      return { ops: setState(item, "open"), target, label: `Reopened ${item.title}` };
    }

    case "block": {
      const { target, question } = resolve(project, mapping, intent.target, "Which item is blocked?");
      if (!target) return { ops: [], label: "Block an item", question };
      const blocker = resolve(project, mapping, intent.blocker, "What is it waiting for?");
      if (!blocker.target) return { ops: [], label: "Block an item", question: blocker.question ?? "What is it waiting for?" };
      const item = byKey.get(target.key)!, other = byKey.get(blocker.target.key)!;
      const ops = addBlocker(project, item, other.key);
      if (!ops.length) return { ops: [], label: "Block an item", question: `${item.title} already waits for ${other.title}` };
      return { ops, target, second: blocker.target, label: `${item.title} now waits for ${other.title}` };
    }

    case "unblock": {
      const { target, question } = resolve(project, mapping, intent.target, "Which item?");
      if (!target) return { ops: [], label: "Remove a blocker", question };
      const item = byKey.get(target.key)!;
      const blocker = intent.blocker ? resolve(project, mapping, intent.blocker, "Which blocker?") : { target: null as Target | null, question: undefined as string | undefined };
      const ref = blocker.target ? item.blockedBy.find(b => b.key === blocker.target!.key) : item.blockedBy[0];
      if (!ref) return { ops: [], label: "Remove a blocker", question: `${item.title} is not blocked by anything` };
      return { ops: removeBlocker(item, ref.key), target, label: `${item.title} no longer waits for ${byKey.get(ref.key)?.title ?? ref.key}` };
    }

    case "merge": {
      const { target, question } = resolve(project, mapping, intent.target, "Which epic should be merged?");
      if (!target) return { ops: [], label: "Merge two epics", question };
      const into = resolve(project, mapping, intent.into, "Merge it into which epic?");
      if (!into.target) return { ops: [], label: "Merge two epics", question: into.question ?? "Merge it into which epic?" };
      const from = byKey.get(target.key)!, to = byKey.get(into.target.key)!;
      if (!isEpic(from, mapping) || !isEpic(to, mapping)) return { ops: [], label: "Merge two epics", question: "Both sides have to be epics" };
      const ops = mergeEpics(project, to, from);
      if (!ops.length) return { ops: [], label: "Merge two epics", question: "Those two epics cannot be merged" };
      return { ops, target, second: into.target, label: `Merged ${from.title} into ${to.title}` };
    }

    case "archive": {
      const { target, question } = resolve(project, mapping, intent.target, "Which item?");
      if (!target) return { ops: [], label: "Remove an item", question };
      const item = byKey.get(target.key)!;
      return { ops: [{ kind: "archive", key: item.key }], target, label: `Removed ${item.title} from the project` };
    }

    case "owner": {
      const { target, question } = resolve(project, mapping, intent.target, "Which item?");
      if (!target) return { ops: [], label: "Set an owner", question };
      const item = byKey.get(target.key)!;
      const who = intent.value === "me" ? (peopleOptions(project)[0] ?? "") : intent.value;
      if (!who) return { ops: [], label: "Set an owner", question: "Who should own it?" };
      const ops = setAssignees(item, [who]);
      if (!ops.length) return { ops: [], label: "Set an owner", question: `There is nobody called “${intent.value}”` };
      return { ops, target, label: `${who} now owns ${item.title}` };
    }

    case "create": {
      const under = intent.under ? resolve(project, mapping, intent.under, "Under which epic?") : { target: null as Target | null, question: undefined as string | undefined };
      if (intent.under && !under.target) return { ops: [], label: "Create something", question: under.question ?? "Under which epic?" };
      const parent = under.target ? byKey.get(under.target.key) : undefined;
      const ops = newItem(project, mapping, intent.title, { parentKey: parent?.key ?? null, epic: intent.epic });
      if (!ops.length) return { ops: [], label: "Create something", question: "What should it be called?" };
      return { ops, label: `New ${intent.epic ? "epic" : "story"}: ${intent.title}` };
    }
  }
}

/** The things a phrase could mean, for the question when there is more than one. */
export function choicesFor(project: Project, mapping: Mapping, phrase: string): Target[] {
  return findTargets(project, mapping, phrase, 5);
}

/** The releases, lanes and people, so a spoken value can be checked against them. */
export function knownValues(project: Project, mapping: Mapping): { releases: string[]; lanes: string[]; people: string[] } {
  return {
    releases: [...new Set([...milestoneOptions(project).map((m: { title: string }) => m.title), ...epicOptions(project, mapping).map((e: { title: string }) => e.title)])].filter(Boolean),
    lanes: laneOptions(project, mapping),
    people: peopleOptions(project),
  };
}
