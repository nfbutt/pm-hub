// Two epics, side by side. What each one covers, what they have in common, what only
// one of them has, and the changes you can make by moving stories from one to the other.
// Pure: it compares and it proposes, and the proposals are ordinary operations.
import { moveToParent } from "../edits";
import { isEpic, releaseOf, type Mapping } from "../mapping";
import type { Item, Project } from "../normalize";
import type { Op } from "../ops";

export interface EpicSide {
  epic: Item;
  /** The stories under it. */
  stories: Item[];
  /** How much of each kind of work it is. */
  mix: Map<string, number>;
  /** The kind of work it mostly is. */
  category: string;
  start: string | null;
  end: string | null;
  release: string | null;
  /** How much of it is done. */
  done: number;
}

export interface Comparison {
  a: EpicSide;
  b: EpicSide;
  /** Stories under both. GitHub gives an issue one parent, but a draft can hold both. */
  inBoth: Item[];
  /** Stories only under the first. */
  onlyInA: Item[];
  /** Stories only under the second. */
  onlyInB: Item[];
  /** The words the two have in common. */
  shared: string[];
  /** How alike they are, 0–1, from the Epic Map's own measure. */
  overlap: number | null;
}

/** The stories of an epic: the items whose nearest epic ancestor is this one. */
export function storiesOf(project: Project, epic: Item): Item[] {
  const byKey = new Map(project.items.map(i => [i.key, i]));
  const out: Item[] = [];
  for (const item of project.items) {
    if (item.key === epic.key || item.state !== "open") continue;
    let parent = item.parentKey;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      if (parent === epic.key) { out.push(item); break; }
      const p = byKey.get(parent);
      if (!p) break;
      parent = p.parentKey;
    }
  }
  return out;
}

/** The kind of work each story is, and how much of it there is. */
function mixOf(stories: Item[]): { mix: Map<string, number>; category: string } {
  const counts = new Map<string, number>();
  for (const s of stories) {
    for (const label of s.labels) {
      if (!/^(area|type|kind|category|product|team|component):/i.test(label)) continue;
      const name = label.split(":").slice(1).join(":").trim().toLowerCase();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const mix = new Map<string, number>();
  for (const [k, v] of counts) mix.set(k, total ? v / total : 0);
  let category = "other";
  let best = 0;
  for (const [k, v] of mix) if (v > best) { best = v; category = k; }
  return { mix, category };
}

/** The words the two sides have in common. */
export function sharedWords(a: EpicSide, b: EpicSide, limit = 12): string[] {
  const words = (side: EpicSide) => {
    const out = new Map<string, number>();
    for (const s of side.stories) {
      for (const w of s.title.toLowerCase().split(/[^a-z0-9]+/)) {
        if (w.length < 4) continue;
        out.set(w, (out.get(w) ?? 0) + 1);
      }
    }
    return out;
  };
  const wa = words(a), wb = words(b);
  const shared: string[] = [];
  for (const [w, n] of wa) {
    const m = wb.get(w);
    if (!m) continue;
    // Words both sides use often are the words they have in common.
    if (n + m < 2 && shared.length >= limit) continue;
    shared.push(w);
  }
  return shared.sort((x, y) => (wb.get(y)! + wa.get(y)!) - (wb.get(x)! + wa.get(x)!)).slice(0, limit);
}

/** Everything about two epics, side by side. */
export function compareEpics(project: Project, mapping: Mapping, a: Item, b: Item, overlap: number | null = null): Comparison {
  const side = (epic: Item): EpicSide => {
    const stories = storiesOf(project, epic);
    const { mix, category } = mixOf(stories);
    const total = epic.subIssues?.total ?? stories.length;
    const doneCount = epic.subIssues?.completed ?? stories.filter(s => s.state !== "open").length;
    return {
      epic, stories, mix, category,
      start: null, end: null, release: releaseOf(epic, mapping)?.title ?? null,
      done: total ? Math.round((100 * doneCount) / total) : 0,
    };
  };
  const sa = side(a), sb = side(b);
  const keysA = new Set(sa.stories.map(s => s.key));
  const keysB = new Set(sb.stories.map(s => s.key));
  const inBoth = sa.stories.filter(s => keysB.has(s.key));
  return {
    a: sa, b: sb,
    inBoth,
    onlyInA: sa.stories.filter(s => !keysB.has(s.key)),
    onlyInB: sb.stories.filter(s => !keysA.has(s.key)),
    shared: sharedWords(sa, sb),
    overlap,
  };
}

/** The change that moves a story from one epic to the other. */
export function moveStory(project: Project, story: Item, to: Item): Op[] {
  if (story.key === to.key) return [];
  return moveToParent(project, story, to.key);
}

/** A change, as the user sees it before it is made. */
export interface ProposedMove {
  story: Item;
  from: Item;
  to: Item;
  ops: Op[];
  /** Whether the user still wants it. */
  include?: boolean;
}

export function proposeMove(project: Project, story: Item, from: Item, to: Item): ProposedMove | null {
  const ops = moveStory(project, story, to);
  if (!ops.length) return null;
  return { story, from, to, ops };
}

/** The labels for the sides, for the headings. */
export function sideLabel(side: EpicSide): string {
  const dates = side.start && side.end ? ` · ${side.start} – ${side.end}` : "";
  return `${side.epic.title}${dates}`;
}

/** The items an epic can be compared with: the other open epics. */
export function comparableEpics(project: Project, mapping: Mapping, except: string | null = null): Item[] {
  return project.items
    .filter(i => isEpic(i, mapping) && i.state === "open" && i.key !== except)
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** The title of an item, for a message. */
export const titleOf = (project: Project, key: string): string =>
  project.items.find(i => i.key === key)?.title ?? key;
