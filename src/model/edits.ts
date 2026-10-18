// User intentions turned into ops. Shared by the drawer, the Gantt, the Plan table and
// the command menu, so every surface edits the same way. Pure.
import { addDays, isEpic, laneOf, splitPrefixed, type Mapping } from "./mapping";
import type { FieldValue, Item, Milestone, Project } from "./normalize";
import { datesOp, newKey, type Op } from "./ops";
import { buildSchedule, daysBetween } from "./schedule";

export type ShiftMode = "keep-gap" | "on-overlap" | "none";

const byKeyOf = (p: Project) => new Map(p.items.map(i => [i.key, i]));

/**
 * Moves or resizes an item's bar, and its dependents according to `mode`:
 * - keep-gap: dependents move by the same amount the blocker's end moved (both directions);
 * - on-overlap: a dependent only moves later, and only when it would now start before the blocker ends;
 * - none: dependents stay put.
 */
export function setDatesWithDependents(p: Project, m: Mapping, key: string, start: string, end: string, mode: ShiftMode): Op[] {
  const s = buildSchedule(p, m);
  const byKey = byKeyOf(p);
  const item = byKey.get(key);
  if (!item) return [];
  const ops: Op[] = [datesOp(item, m, start, end)];
  if (mode === "none") return ops;
  const oldEnd = s.bars.get(key)?.end ?? end;
  const delta = daysBetween(oldEnd, end);
  const moved = new Map<string, { start: string; end: string }>([[key, { start, end }]]);
  const queue = [key];
  while (queue.length) {
    const blocker = queue.shift()!;
    const bEnd = moved.get(blocker)!.end;
    for (const dep of p.items) {
      if (dep.state !== "open" || moved.has(dep.key) || !dep.blockedBy.some(b => b.key === blocker)) continue;
      const bar = s.bars.get(dep.key);
      if (!bar) continue;
      let shift = 0;
      if (mode === "keep-gap") shift = delta;
      else if (bar.start <= bEnd) shift = daysBetween(bar.start, bEnd) + 1;
      if (shift === 0) continue;
      const next = { start: addDays(bar.start, shift), end: addDays(bar.end, shift) };
      moved.set(dep.key, next);
      ops.push(datesOp(dep, m, next.start, next.end));
      queue.push(dep.key);
    }
  }
  return ops;
}

/** Shifts several items by whole days, keeping their length. Items without dates are skipped. */
export function shiftDates(p: Project, m: Mapping, keys: string[], days: number): Op[] {
  const s = buildSchedule(p, m);
  const byKey = byKeyOf(p);
  return keys.flatMap(k => {
    const item = byKey.get(k), bar = s.bars.get(k);
    return item && bar ? [datesOp(item, m, addDays(bar.start, days), addDays(bar.end, days))] : [];
  });
}

export function setField(item: Item, field: string, value: FieldValue | null): Op[] {
  const before = item.fields[field] ?? null;
  // Single-selects compare by option name: cached projects may carry stale option ids.
  const same = before?.kind === "single" && value?.kind === "single" ? before.name === value.name : JSON.stringify(before) === JSON.stringify(value);
  return same ? [] : [{ kind: "setField", key: item.key, field, before, after: value }];
}

/** Sets a single-select field by option name. */
export function setOption(p: Project, item: Item, field: string, optionName: string | null): Op[] {
  const def = p.fields.find(f => f.name === field);
  if (def?.kind !== "single") return [];
  if (optionName === null) return setField(item, field, null);
  const opt = def.options.find(o => o.name === optionName);
  return opt ? setField(item, field, { kind: "single", name: opt.name, optionId: opt.id }) : [];
}

/** Changes an item's swimlane, whether lanes come from a field or a label prefix. */
export function setLane(p: Project, m: Mapping, item: Item, lane: string): Op[] {
  if (laneOf(item, m) === lane) return [];
  if (m.lane.kind === "field") return setOption(p, item, m.lane.field, lane);
  if (m.lane.kind === "labelPrefix") {
    const prefix = m.lane.prefix;
    // Reuse the exact spelling of an existing label, e.g. "product: intelligence".
    const existing = p.items.flatMap(i => i.labels).find(l => { const s = splitPrefixed(l); return s?.[0] === prefix && s[1] === lane; }) ?? `${prefix}: ${lane}`;
    const after = [...item.labels.filter(l => splitPrefixed(l)?.[0] !== prefix), existing];
    return [{ kind: "setLabels", key: item.key, before: item.labels, after }];
  }
  return [];
}

/** Every lane value seen in the project, for pickers. */
export function laneOptions(p: Project, m: Mapping): string[] {
  if (m.lane.kind === "field") { const f = p.fields.find(x => x.name === (m.lane as { field: string }).field); return f?.kind === "single" ? f.options.map(o => o.name) : []; }
  if (m.lane.kind === "labelPrefix") return [...new Set(p.items.map(i => laneOf(i, m)).filter((l): l is string => !!l))].sort();
  return [];
}

export function setMilestone(item: Item, milestone: Milestone | null): Op[] {
  if ((item.milestone?.title ?? null) === (milestone?.title ?? null)) return [];
  return [{ kind: "setMilestone", key: item.key, before: item.milestone, after: milestone }];
}

/** Milestones seen in the project, one per title and repo. */
export function milestoneOptions(p: Project, repo?: string | null): Milestone[] {
  const seen = new Map<string, Milestone>();
  for (const i of p.items) if (i.milestone && (!repo || i.milestone.repo === repo)) seen.set(`${i.milestone.repo}#${i.milestone.title}`, i.milestone);
  return [...seen.values()].sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
}

export function setAssignees(item: Item, logins: string[]): Op[] {
  const after = [...new Set(logins)];
  return JSON.stringify(after) === JSON.stringify(item.assignees) ? [] : [{ kind: "setAssignees", key: item.key, before: item.assignees, after }];
}
export const peopleOptions = (p: Project) => [...new Set(p.items.flatMap(i => i.assignees))].sort();
export const labelOptions = (p: Project) => [...new Set(p.items.flatMap(i => i.labels))].sort();

export function setLabels(item: Item, labels: string[]): Op[] {
  const after = [...new Set(labels)];
  return JSON.stringify(after) === JSON.stringify(item.labels) ? [] : [{ kind: "setLabels", key: item.key, before: item.labels, after }];
}

export function setTitle(item: Item, title: string): Op[] {
  const t = title.trim();
  return !t || t === item.title ? [] : [{ kind: "setTitle", key: item.key, before: item.title, after: t }];
}

export function setState(item: Item, state: "open" | "closed", reason: string | null = null): Op[] {
  if (item.state === state && (state === "open" || item.stateReason === reason)) return [];
  return [{ kind: "setState", key: item.key, before: { state: item.state === "open" ? "open" : "closed", reason: item.stateReason }, after: { state, reason: state === "closed" ? reason ?? "COMPLETED" : null } }];
}

/** Moves an item under another epic (or out of any epic with null). Refuses to create a loop. */
export function moveToParent(p: Project, item: Item, parentKey: string | null): Op[] {
  if (item.parentKey === parentKey || item.key === parentKey) return [];
  if (parentKey) {
    const byKey = byKeyOf(p);
    for (let k: string | null = parentKey; k; k = byKey.get(k)?.parentKey ?? null) if (k === item.key) return [];
  }
  return [{ kind: "setParent", key: item.key, before: item.parentKey, after: parentKey }];
}

export function addBlocker(p: Project, item: Item, blockerKey: string): Op[] {
  if (blockerKey === item.key || item.blockedBy.some(b => b.key === blockerKey)) return [];
  // A blocker that is (transitively) blocked by this item would make a loop.
  const byKey = byKeyOf(p);
  const seen = new Set<string>(); const stack = [blockerKey];
  while (stack.length) { const k = stack.pop()!; if (k === item.key) return []; if (seen.has(k)) continue; seen.add(k); for (const b of byKey.get(k)?.blockedBy ?? []) stack.push(b.key); }
  return [{ kind: "addBlockedBy", key: item.key, blocker: blockerKey }];
}
export const removeBlocker = (item: Item, blockerKey: string): Op[] => (item.blockedBy.some(b => b.key === blockerKey) ? [{ kind: "removeBlockedBy", key: item.key, blocker: blockerKey }] : []);

/** A new issue in the same repo as its parent (or `repo`), with the parent's lane. */
export function newItem(p: Project, m: Mapping, title: string, opts: { parentKey?: string | null; repo?: string | null; epic?: boolean }): Op[] {
  const parent = opts.parentKey ? byKeyOf(p).get(opts.parentKey) : undefined;
  const repo = opts.repo ?? parent?.repo ?? p.items.find(i => i.repo)?.repo ?? null;
  const labels: string[] = [];
  if (opts.epic && m.epic.label) labels.push(m.epic.label);
  if (!opts.epic) { const storyLabel = labelOptions(p).find(l => /^(type|kind)\s*:\s*(story|task)$/i.test(l)); if (storyLabel && m.epic.label) labels.push(storyLabel); }
  const fields: Record<string, FieldValue> = {};
  if (parent && m.lane.kind === "labelPrefix") { const prefix = m.lane.prefix; const l = parent.labels.find(x => splitPrefixed(x)?.[0] === prefix); if (l) labels.push(l); }
  if (parent && m.lane.kind === "field" && parent.fields[m.lane.field]) fields[m.lane.field] = parent.fields[m.lane.field]!;
  return [{ kind: "create", key: newKey(), item: { title: title.trim() || "Untitled", repo, parentKey: parent?.key ?? null, labels, fields } }];
}

/** Splits an item: a new sibling (or child of the same epic) takes the chosen sub-issues. */
export function splitItem(p: Project, m: Mapping, item: Item, newTitle: string, moveKeys: string[]): Op[] {
  const create = newItem(p, m, newTitle, { parentKey: item.parentKey, repo: item.repo, epic: isEpic(item, m) })[0]!;
  if (create.kind !== "create") return [];
  create.item.labels = [...new Set([...item.labels])];
  create.item.fields = { ...item.fields };
  const byKey = byKeyOf(p);
  const moves = moveKeys.map(k => byKey.get(k)).filter((c): c is Item => !!c && c.parentKey === item.key)
    .map(c => ({ kind: "setParent", key: c.key, before: item.key, after: create.key }) as Op);
  return [create, ...moves];
}

/** Marks an item as an epic using the project's own convention (label or issue type). */
export function promoteToEpic(m: Mapping, item: Item): Op[] {
  if (m.epic.label && !item.labels.includes(m.epic.label)) {
    const prefix = splitPrefixed(m.epic.label)?.[0];
    return setLabels(item, [...item.labels.filter(l => !prefix || splitPrefixed(l)?.[0] !== prefix), m.epic.label]);
  }
  return [];
}

/** Epics, for "move to epic" pickers. */
export const epicOptions = (p: Project, m: Mapping) => p.items.filter(i => isEpic(i, m) && i.state === "open").sort((a, b) => a.title.localeCompare(b.title));
