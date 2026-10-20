// Reading a plan-history baseline as a project, so the map can be run on the plan as it
// was. A baseline keeps the shape of the plan (who is under what, what was open, which
// items were epics) but not the words, so the text comes from today's project when the
// item is still there. Pure.
import type { Baseline } from "../diff";
import type { Mapping } from "../mapping";
import { emptyIds, type Item, type Project } from "../normalize";

/** An item as the baseline remembers it, with nothing filled in. */
function stub(key: string, title: string): Item {
  return {
    id: key, key, kind: "issue", number: null, repo: null, title, body: undefined, url: null,
    state: "open", stateReason: null, createdAt: null, closedAt: null, updatedAt: null,
    labels: [], assignees: [], milestone: null, issueType: null, parentKey: null, subIssues: null,
    blockedBy: [], archived: false, fields: {}, ids: emptyIds(),
  };
}

/**
 * The project as it was at that baseline: today's items, with the baseline's structure.
 * Items that are new since then are left out; items that are gone keep their shape.
 */
export function baselineProject(current: Project, b: Baseline): Project {
  const byKey = new Map(current.items.map(i => [i.key, i]));
  const items: Item[] = b.items.map(bi => {
    const real = byKey.get(bi.key);
    const item: Item = real ? { ...real, fields: { ...real.fields }, labels: [...real.labels], assignees: [...real.assignees], blockedBy: [...real.blockedBy] } : stub(bi.key, bi.title);
    item.title = bi.title;
    item.parentKey = bi.parentKey;
    item.state = bi.state === "merged" ? "merged" : bi.state === "closed" ? "closed" : "open";
    item.issueType = bi.epic ? "Epic" : null;
    item.subIssues = bi.sub ? { total: bi.sub.total, completed: bi.sub.done } : null;
    return item;
  });
  return { ...current, items };
}

/**
 * The mapping that reads a baseline: which items are epics comes from the baseline
 * itself, not from the labels the project happens to use today.
 */
export function baselineMapping(m: Mapping): Mapping {
  return { ...m, epic: { subIssues: false, issueTypes: ["Epic"], label: null } };
}
