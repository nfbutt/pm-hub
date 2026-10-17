// How a project's fields map onto roadmap concepts. Auto-detected so any project
// works out of the box; every choice is editable and saved per project.
import type { FieldDef, Item, Project } from "./normalize";

export type LaneRule = { kind: "none" } | { kind: "field"; field: string } | { kind: "labelPrefix"; prefix: string };
export type ReleaseRule = { kind: "none" } | { kind: "milestone" } | { kind: "iteration"; field: string } | { kind: "field"; field: string };

export interface Mapping {
  /** Date field used as bar start. */
  startField: string | null;
  /** Date field used as bar end. */
  endField: string | null;
  /** Iteration field used for bars when an item has no dates. */
  iterationField: string | null;
  /** Use the milestone due date as a bar end when nothing else is set. */
  milestoneDates: boolean;
  epic: { subIssues: boolean; issueTypes: string[]; label: string | null };
  lane: LaneRule;
  release: ReleaseRule;
  statusField: string | null;
  priority: { kind: "none" } | { kind: "field"; field: string } | { kind: "labelPrefix"; prefix: string };
}

const fieldsOf = (p: Project, kind: FieldDef["kind"]) => p.fields.filter(f => f.kind === kind);
const usage = (p: Project, name: string) => p.items.filter(i => i.fields[name] !== undefined).length;

/** "product: intelligence" -> ["product", "intelligence"] */
export function splitPrefixed(label: string): [string, string] | null {
  const m = label.match(/^([^:]{1,30}):\s*(.+)$/);
  return m ? [m[1]!.trim().toLowerCase(), m[2]!.trim()] : null;
}

export function labelPrefixes(p: Project): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const i of p.items) for (const l of i.labels) {
    const s = splitPrefixed(l);
    if (!s) continue;
    if (!out.has(s[0])) out.set(s[0], new Set());
    out.get(s[0])!.add(s[1]);
  }
  return out;
}

export function detectMapping(p: Project): Mapping {
  const dates = fieldsOf(p, "date").filter(f => usage(p, f.name) > 0 || fieldsOf(p, "date").length <= 2);
  const startField = dates.find(f => /start|begin|kick/i.test(f.name))?.name ?? null;
  let endField = dates.find(f => /end|target|due|finish|deadline/i.test(f.name) && f.name !== startField)?.name ?? null;
  if (!endField && dates.length === 1 && dates[0]!.name !== startField) endField = dates[0]!.name;

  const iterations = fieldsOf(p, "iteration").sort((a, b) => usage(p, b.name) - usage(p, a.name));
  const iterationField = iterations.find(f => usage(p, f.name) > 0)?.name ?? null;

  const issueTypes = [...new Set(p.items.map(i => i.issueType).filter((t): t is string => !!t && /epic/i.test(t)))];
  const labelCounts = new Map<string, number>();
  for (const i of p.items) for (const l of i.labels) if (/(^|[^a-z])epics?([^a-z]|$)/i.test(l)) labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);
  // Prefer a type-style label ("type: epic") over per-epic labels ("epic: payments").
  const epicLabel = [...labelCounts.entries()]
    .sort((a, b) => Number(/^(type|kind)\s*:/i.test(b[0])) - Number(/^(type|kind)\s*:/i.test(a[0])) || b[1] - a[1])[0]?.[0] ?? null;
  const typeLike = epicLabel && /^(type|kind)\s*:\s*epic/i.test(epicLabel) ? epicLabel : epicLabel && /^epic$/i.test(epicLabel) ? epicLabel : null;

  const singles = fieldsOf(p, "single");
  const laneField = singles.find(f => /product|team|area|workstream|lane|squad|track/i.test(f.name) && usage(p, f.name) > 0);
  const prefixes = labelPrefixes(p);
  const lanePrefix = ["product", "team", "area", "workstream", "track"].find(x => (prefixes.get(x)?.size ?? 0) >= 2);
  const lane: LaneRule = laneField ? { kind: "field", field: laneField.name } : lanePrefix ? { kind: "labelPrefix", prefix: lanePrefix } : { kind: "none" };

  const withMilestone = p.items.filter(i => i.milestone).length;
  const releaseField = singles.find(f => /release|version|phase|milestone/i.test(f.name) && usage(p, f.name) > 0);
  const release: ReleaseRule =
    withMilestone >= 3 ? { kind: "milestone" }
    : releaseField ? { kind: "field", field: releaseField.name }
    : iterationField ? { kind: "iteration", field: iterationField }
    : { kind: "none" };

  const statusField = singles.find(f => /^status$/i.test(f.name))?.name ?? singles.find(f => /status|state|stage/i.test(f.name))?.name ?? null;
  const prioField = singles.find(f => /priority/i.test(f.name) && usage(p, f.name) > 0);
  const priority: Mapping["priority"] = prioField ? { kind: "field", field: prioField.name }
    : prefixes.has("priority") ? { kind: "labelPrefix", prefix: "priority" } : { kind: "none" };

  return {
    startField, endField, iterationField, milestoneDates: true,
    epic: { subIssues: true, issueTypes, label: typeLike },
    lane, release, statusField, priority,
  };
}

export function isEpic(i: Item, m: Mapping): boolean {
  if (i.kind !== "issue") return false;
  if (m.epic.subIssues && i.subIssues && i.subIssues.total > 0) return true;
  if (i.issueType && m.epic.issueTypes.includes(i.issueType)) return true;
  if (m.epic.label && i.labels.includes(m.epic.label)) return true;
  return false;
}

function prefixedValue(i: Item, prefix: string): string | null {
  for (const l of i.labels) { const s = splitPrefixed(l); if (s && s[0] === prefix) return s[1]; }
  return null;
}

export function laneOf(i: Item, m: Mapping): string | null {
  if (m.lane.kind === "field") { const v = i.fields[m.lane.field]; return v?.kind === "single" ? v.name : null; }
  if (m.lane.kind === "labelPrefix") return prefixedValue(i, m.lane.prefix);
  return null;
}

export interface ReleaseRef { id: string; title: string; due: string | null; start: string | null }

export function releaseOf(i: Item, m: Mapping): ReleaseRef | null {
  if (m.release.kind === "milestone" && i.milestone) {
    return { id: `m:${i.milestone.repo}:${i.milestone.number}`, title: i.milestone.title, due: i.milestone.dueOn?.slice(0, 10) ?? null, start: null };
  }
  if (m.release.kind === "iteration") {
    const v = i.fields[m.release.field];
    if (v?.kind === "iteration") return { id: `i:${v.iterationId}`, title: v.title, start: v.startDate, due: addDays(v.startDate, v.duration - 1) };
  }
  if (m.release.kind === "field") {
    const v = i.fields[m.release.field];
    if (v?.kind === "single") return { id: `f:${v.optionId}`, title: v.name, due: null, start: null };
  }
  return null;
}

export function statusOf(i: Item, m: Mapping): string | null {
  if (!m.statusField) return null;
  const v = i.fields[m.statusField];
  return v?.kind === "single" ? v.name : null;
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, critical: 0, p0: 0, high: 1, p1: 1, medium: 2, normal: 2, p2: 2, low: 3, p3: 3 };

export function priorityOf(i: Item, m: Mapping): { name: string; rank: number } | null {
  let name: string | null = null;
  if (m.priority.kind === "field") { const v = i.fields[m.priority.field]; name = v?.kind === "single" ? v.name : null; }
  if (m.priority.kind === "labelPrefix") name = prefixedValue(i, m.priority.prefix);
  if (!name) return null;
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return { name, rank: PRIORITY_RANK[key] ?? 2 };
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
