// Tidying an epic's subtasks. A model reads the epic and its stories and says what is
// missing, what is named badly, and which two stories look like the same work. The
// person decides: every suggestion is a tick, and the changes are ordinary operations.
import { setTitle } from "../edits";
import type { Item, Project } from "../normalize";
import type { Op } from "../ops";
import { storiesOf } from "./compare";

export interface ProposedStory {
  title: string;
  why: string;
  days: number;
}

export interface ProposedRename {
  key: string;
  from: string;
  to: string;
  why: string;
}

export interface ProposedOverlap {
  keys: string[];
  titles: string[];
  why: string;
}

export interface Amendments {
  /** Work the epic is missing. */
  add: ProposedStory[];
  /** Stories whose name says something else. */
  rename: ProposedRename[];
  /** Two stories that look like the same work. */
  overlap: ProposedOverlap[];
}

/** A change the user has picked, and the operation that carries it out. */
export interface PickedChange {
  id: string;
  kind: "add" | "rename" | "archive";
  label: string;
  ops: Op[];
}

/**
 * The operations for the changes that were picked. A new story is created under the
 * epic, a renamed story keeps its place, and a story the user thinks is a duplicate is
 * taken out of the project.
 */
export function amendmentOps(project: Project, epic: Item, amendments: Amendments, picked: Set<string>): PickedChange[] {
  const out: PickedChange[] = [];
  const byKey = new Map(project.items.map(i => [i.key, i]));
  for (const s of amendments.add) {
    const id = `add:${s.title}`;
    if (!picked.has(id)) continue;
    const ops: Op[] = [{ kind: "create", key: `new:${id}`, item: { title: s.title, body: s.why || undefined, repo: epic.repo, parentKey: epic.key, labels: [], fields: {} } }];
    out.push({ id, kind: "add", label: `Add “${s.title}”`, ops });
  }
  for (const r of amendments.rename) {
    const id = `rename:${r.key}`;
    if (!picked.has(id)) continue;
    const item = byKey.get(r.key);
    if (!item) continue;
    out.push({ id, kind: "rename", label: `Rename “${r.from}” to “${r.to}”`, ops: setTitle(item, r.to) });
  }
  for (const o of amendments.overlap) {
    const id = `archive:${o.keys[0]}`;
    if (!picked.has(id)) continue;
    const item = byKey.get(o.keys[0] ?? "");
    if (!item) continue;
    out.push({ id, kind: "archive", label: `Remove “${item.title}” (it repeats ${o.titles[1] ?? "another story"})`, ops: [{ kind: "archive", key: item.key }] });
  }
  return out;
}

/** The stories of an epic, as the model is shown them. */
export function epicStories(project: Project, epic: Item): { key: string; title: string; body: string }[] {
  return storiesOf(project, epic).map(s => ({ key: s.key, title: s.title, body: (s.body ?? "").slice(0, 160).replace(/\s+/g, " ").trim() }));
}

/**
 * A model tends to copy the line it was shown, key and all: "PMH-13 | Add billing page".
 * A story's title is not that, so take the key off the front. The key is in one of the
 * two shapes pm-hub sees: "PMH-13" and "owner/repo#13".
 */
export function cleanTitle(text: string): string {
  return text.replace(/^[A-Za-z0-9_.\-/]+(?:#\d+|-#?\d+)\s*[|:\u2013-]\s*/, "").trim();
}

/**
 * The amendments as they should be shown and applied. The model is trusted for *which*
 * stories to change and *what to say*, not for the titles: it echoes them badly, and the
 * project already knows what every story is called.
 */
export function tidyAmendments(project: Project, epic: Item, answer: Amendments): Amendments {
  const stories = new Map(epicStories(project, epic).map(s => [s.key, s]));
  return {
    add: answer.add.map(s => ({ ...s, title: cleanTitle(s.title) || s.title })),
    rename: answer.rename
      .filter(r => stories.has(r.key))
      .map(r => ({ ...r, from: stories.get(r.key)!.title, to: cleanTitle(r.to) || r.to })),
    overlap: answer.overlap
      .filter(o => o.keys.length === 2 && o.keys.every(k => stories.has(k)))
      .map(o => ({ ...o, titles: o.keys.map(k => stories.get(k)!.title) })),
  };
}
