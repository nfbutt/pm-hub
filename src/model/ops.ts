// The change set: every edit is an operation with its before and after values.
// One list drives undo/redo, the review screen and (later) the history feed.
// Pure: applying ops never touches GitHub; that happens only in the apply step.
import type { Mapping } from "./mapping";
import type { FieldValue, Item, Milestone, Project } from "./normalize";
import { emptyIds } from "./normalize";
import { emptyDraft, type Draft } from "./schedule";

export interface DateRange { start: string | null; end: string | null }
export interface StateValue { state: "open" | "closed"; reason: string | null }
export interface NewItem { title: string; repo: string | null; parentKey: string | null; labels: string[]; fields: Record<string, FieldValue> }

export type Op =
  /** Bar dates. `fields` records which date fields the dates map to when the op was made. */
  | { kind: "setDates"; key: string; fields: { start: string | null; end: string | null }; before: DateRange; after: DateRange }
  | { kind: "setField"; key: string; field: string; before: FieldValue | null; after: FieldValue | null }
  | { kind: "setTitle"; key: string; before: string; after: string }
  | { kind: "setState"; key: string; before: StateValue; after: StateValue }
  | { kind: "setParent"; key: string; before: string | null; after: string | null }
  | { kind: "setLabels"; key: string; before: string[]; after: string[] }
  | { kind: "setMilestone"; key: string; before: Milestone | null; after: Milestone | null }
  | { kind: "setAssignees"; key: string; before: string[]; after: string[] }
  | { kind: "addBlockedBy"; key: string; blocker: string }
  | { kind: "removeBlockedBy"; key: string; blocker: string }
  | { kind: "create"; key: string; item: NewItem }
  | { kind: "archive"; key: string }
  | { kind: "unarchive"; key: string }
  // Local only: never written to GitHub.
  | { kind: "park"; key: string; before: boolean; after: boolean }
  | { kind: "reorder"; lane: string; before: string[]; after: string[] };

export type OpKind = Op["kind"];
export const LOCAL_ONLY: ReadonlySet<OpKind> = new Set(["park", "reorder"]);

/** One user action. Several ops in one change undo together (e.g. a split). */
export interface Change { id: string; at: string; label: string; ops: Op[]; reason?: string }

export const newKey = () => `new:${Math.random().toString(36).slice(2, 10)}`;
export const isNewKey = (key: string) => key.startsWith("new:");
export const changeId = () => `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// ---------------------------------------------------------------- applying

export interface Applied {
  /** The project as edited. */
  project: Project;
  /** Local-only overlay: row order, parked items, and dates that have no field to live in. */
  local: Draft;
  /** Items whose dates can't all be saved because the project lacks a start or end field. */
  unsavableDates: Set<string>;
}

function fieldDate(i: Item, name: string | null): string | null {
  if (!name) return null;
  const v = i.fields[name];
  return v?.kind === "date" ? v.date.slice(0, 10) : null;
}

/** A setDates op for an item, recording its current dates on the mapped fields as `before`. */
export function datesOp(item: Item, m: Mapping, start: string, end: string): Op {
  return {
    kind: "setDates", key: item.key, fields: { start: m.startField, end: m.endField },
    before: { start: fieldDate(item, m.startField), end: fieldDate(item, m.endField) },
    after: { start, end },
  };
}

function adjustSubIssues(parent: Item | undefined, child: Item, delta: 1 | -1) {
  if (!parent) return;
  const s = parent.subIssues ?? { total: 0, completed: 0 };
  const next = { total: s.total + delta, completed: s.completed + (child.state !== "open" ? delta : 0) };
  parent.subIssues = next.total > 0 ? next : null;
}

export function applyOps(base: Project, ops: Op[]): Applied {
  const project: Project = { ...base, items: base.items.map(i => ({ ...i, fields: { ...i.fields }, labels: [...i.labels], assignees: [...i.assignees], blockedBy: [...i.blockedBy] })) };
  const byKey = new Map(project.items.map(i => [i.key, i]));
  const local = emptyDraft();
  const unsavableDates = new Set<string>();
  const parked = new Set<string>();

  for (const op of ops) {
    if (op.kind === "reorder") { local.order[op.lane] = [...op.after]; continue; }
    if (op.kind === "park") { if (op.after) parked.add(op.key); else parked.delete(op.key); continue; }
    if (op.kind === "create") {
      const parent = op.item.parentKey ? byKey.get(op.item.parentKey) : undefined;
      const item: Item = {
        id: op.key, key: op.key, kind: "issue", number: null, repo: op.item.repo, title: op.item.title, url: null,
        state: "open", stateReason: null, createdAt: null, closedAt: null, updatedAt: null,
        labels: [...op.item.labels], assignees: [], milestone: null, issueType: null, parentKey: op.item.parentKey,
        subIssues: null, blockedBy: [], archived: false, fields: { ...op.item.fields }, ids: emptyIds(),
      };
      project.items.push(item); byKey.set(item.key, item);
      adjustSubIssues(parent, item, 1);
      continue;
    }
    const item = byKey.get(op.key);
    if (!item) continue;
    switch (op.kind) {
      case "setDates": {
        const { start: sf, end: ef } = op.fields;
        if (sf && op.after.start) item.fields[sf] = { kind: "date", date: op.after.start }; else if (sf) delete item.fields[sf];
        if (ef && op.after.end) item.fields[ef] = { kind: "date", date: op.after.end }; else if (ef) delete item.fields[ef];
        // A date with no field to live in stays as a local bar so the chart still shows it.
        if ((!sf || !ef) && op.after.start && op.after.end) {
          local.bars[item.key] = { start: op.after.start, end: op.after.end };
          unsavableDates.add(item.key);
        }
        break;
      }
      case "setField": if (op.after) item.fields[op.field] = op.after; else delete item.fields[op.field]; break;
      case "setTitle": item.title = op.after; break;
      case "setState": {
        item.state = op.after.state; item.stateReason = op.after.reason;
        item.closedAt = op.after.state === "closed" ? (item.closedAt ?? new Date().toISOString()) : null;
        break;
      }
      case "setParent": {
        if (item.parentKey === op.after) break;
        adjustSubIssues(item.parentKey ? byKey.get(item.parentKey) : undefined, item, -1);
        item.parentKey = op.after;
        adjustSubIssues(op.after ? byKey.get(op.after) : undefined, item, 1);
        break;
      }
      case "setLabels": item.labels = [...op.after]; break;
      case "setMilestone": item.milestone = op.after; break;
      case "setAssignees": item.assignees = [...op.after]; break;
      case "addBlockedBy": {
        if (!item.blockedBy.some(b => b.key === op.blocker)) item.blockedBy.push({ key: op.blocker, open: (byKey.get(op.blocker)?.state ?? "open") === "open" });
        break;
      }
      case "removeBlockedBy": item.blockedBy = item.blockedBy.filter(b => b.key !== op.blocker); break;
      case "archive": item.archived = true; break;
      case "unarchive": item.archived = false; break;
    }
  }
  local.parked = [...parked];
  project.items = project.items.filter(i => !i.archived);
  return { project, local, unsavableDates };
}

// ---------------------------------------------------------------- inverses

/** The op that undoes `op` on GitHub. Used to revert an apply. */
export function inverse(op: Op): Op {
  switch (op.kind) {
    case "addBlockedBy": return { kind: "removeBlockedBy", key: op.key, blocker: op.blocker };
    case "removeBlockedBy": return { kind: "addBlockedBy", key: op.key, blocker: op.blocker };
    case "create": return { kind: "archive", key: op.key };
    case "archive": return { kind: "unarchive", key: op.key };
    case "unarchive": return { kind: "archive", key: op.key };
    case "setDates": return { ...op, before: op.after, after: op.before };
    default: return { ...op, before: op.after, after: op.before } as Op;
  }
}

// ---------------------------------------------------------------- net changes

/** What an op edits. Ops on the same slot fold together into one net change. */
export function slotOf(op: Op): string {
  switch (op.kind) {
    case "setField": return `setField:${op.key}:${op.field}`;
    case "reorder": return `reorder:${op.lane}`;
    case "addBlockedBy": case "removeBlockedBy": return `blocked:${op.key}:${op.blocker}`;
    case "archive": case "unarchive": return `archive:${op.key}`;
    case "create": return `create:${op.key}`;
    default: return `${op.kind}:${op.key}`;
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Folds the history into the smallest set of ops with the same effect: the first `before`
 * and the last `after` per slot, dropping anything that ended where it started.
 * History keeps every step (so undo is precise); the counter and review use this.
 */
export function netOps(ops: Op[]): Op[] {
  const order: string[] = [];
  const bySlot = new Map<string, Op>();
  const created = new Set<string>();
  for (const op of ops) {
    if (op.kind === "create") created.add(op.key);
    const slot = slotOf(op);
    const prev = bySlot.get(slot);
    if (!prev) { bySlot.set(slot, op); order.push(slot); continue; }
    if ("before" in prev && "before" in op) bySlot.set(slot, { ...op, before: prev.before } as Op);
    else if (prev.kind !== op.kind && (slot.startsWith("blocked:") || slot.startsWith("archive:"))) bySlot.delete(slot); // add then remove
    else bySlot.set(slot, op);
    if (!order.includes(slot)) order.push(slot);
  }
  const out: Op[] = [];
  for (const slot of order) {
    const op = bySlot.get(slot);
    if (!op) continue;
    if ("before" in op && same(op.before, op.after)) continue;
    // Edits to an item created in this draft are folded into the create itself on apply;
    // an archived new item simply never gets created.
    if (op.kind === "archive" && created.has(op.key)) { const i = out.findIndex(o => o.kind === "create" && o.key === op.key); if (i >= 0) out.splice(i, 1); continue; }
    out.push(op);
  }
  return out;
}

// ---------------------------------------------------------------- words

const fmtDate = (d: string | null) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) : "none");
const fmtRange = (r: DateRange) => (r.start || r.end ? `${fmtDate(r.start)} – ${fmtDate(r.end)}` : "no dates");
export function fmtValue(v: FieldValue | null): string {
  if (!v) return "empty";
  switch (v.kind) {
    case "date": return fmtDate(v.date);
    case "single": return v.name;
    case "iteration": return v.title;
    case "number": return String(v.number);
    case "text": return v.text || "empty";
    case "users": return v.logins.join(", ") || "nobody";
  }
}

/** A short sentence for toasts, the review screen and the history feed. */
export function describe(op: Op, titleOf: (key: string) => string): string {
  const t = "key" in op ? titleOf(op.key) : "";
  switch (op.kind) {
    case "setDates": return `${t}: dates ${fmtRange(op.before)} → ${fmtRange(op.after)}`;
    case "setField": return `${t}: ${op.field} ${fmtValue(op.before)} → ${fmtValue(op.after)}`;
    case "setTitle": return `Renamed “${op.before}” → “${op.after}”`;
    case "setState": return `${t}: ${op.after.state === "closed" ? `closed${op.after.reason === "NOT_PLANNED" ? " as not planned" : ""}` : "reopened"}`;
    case "setParent": return `${t}: moved ${op.before ? `from ${titleOf(op.before)} ` : ""}${op.after ? `to ${titleOf(op.after)}` : "out of its epic"}`;
    case "setLabels": {
      const add = op.after.filter(l => !op.before.includes(l)), rm = op.before.filter(l => !op.after.includes(l));
      return `${t}: labels ${[...add.map(l => `+${l}`), ...rm.map(l => `−${l}`)].join(" ") || "unchanged"}`;
    }
    case "setMilestone": return `${t}: release ${op.before?.title ?? "none"} → ${op.after?.title ?? "none"}`;
    case "setAssignees": return `${t}: owners ${op.before.join(", ") || "nobody"} → ${op.after.join(", ") || "nobody"}`;
    case "addBlockedBy": return `${t}: now blocked by ${titleOf(op.blocker)}`;
    case "removeBlockedBy": return `${t}: no longer blocked by ${titleOf(op.blocker)}`;
    case "create": return `New: ${op.item.title}${op.item.parentKey ? ` under ${titleOf(op.item.parentKey)}` : ""}`;
    case "archive": return `${t}: removed from the project`;
    case "unarchive": return `${t}: restored to the project`;
    case "park": return `${t}: ${op.after ? "parked" : "back on the chart"}`;
    case "reorder": return `Reordered ${op.lane}`;
  }
}

/** Rewrites item keys in an op (e.g. a draft key "new:x" to the created "owner/repo#12"). */
export function remapKeys(op: Op, map: Map<string, string>): Op {
  const k = (key: string) => map.get(key) ?? key;
  const out = { ...op } as Op & { key?: string };
  if ("key" in op) (out as { key: string }).key = k(op.key);
  if (op.kind === "setParent") return { ...(out as typeof op), before: op.before && k(op.before), after: op.after && k(op.after) };
  if (op.kind === "addBlockedBy" || op.kind === "removeBlockedBy") return { ...(out as typeof op), blocker: k(op.blocker) };
  if (op.kind === "reorder") return { ...op, before: op.before.map(k), after: op.after.map(k) };
  return out as Op;
}
