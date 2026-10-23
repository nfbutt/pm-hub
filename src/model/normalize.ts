// Turns raw GraphQL responses into the flat model every view works from.
import type { ProjectMetaData, RawField, RawItem, ViewerProjectsData } from "../github/types";

export interface ProjectSummary {
  id: string; owner: string; number: number; title: string; description: string | null;
  closed: boolean; updatedAt: string; url: string; itemCount: number;
}

export interface Iteration { id: string; title: string; startDate: string; duration: number; completed: boolean }

export type FieldDef =
  | { kind: "date" | "number" | "text" | "builtin"; id: string; name: string; dataType: string }
  | { kind: "single"; id: string; name: string; dataType: string; options: { id: string; name: string; color: string }[] }
  | { kind: "iteration"; id: string; name: string; dataType: string; iterations: Iteration[] };

export type FieldValue =
  | { kind: "date"; date: string }
  | { kind: "single"; name: string; optionId: string }
  | { kind: "iteration"; title: string; startDate: string; duration: number; iterationId: string }
  | { kind: "number"; number: number }
  | { kind: "text"; text: string }
  | { kind: "users"; logins: string[] };

export interface Milestone { id?: string | null; title: string; number: number; dueOn: string | null; state: string; repo: string }

/** GitHub node ids needed to write changes back. Null when unknown (e.g. a project cached by pm-hub v1). */
export interface ItemIds {
  content: string | null;
  repo: string | null;
  parent: string | null;
  /** label name -> label node id */
  labels: Record<string, string>;
  /** login -> user node id */
  assignees: Record<string, string>;
}
export const emptyIds = (): ItemIds => ({ content: null, repo: null, parent: null, labels: {}, assignees: {} });

export interface Item {
  /** Project item id. */
  id: string;
  /** Stable reference: "owner/repo#123" for issues and PRs, the item id for drafts. */
  key: string;
  kind: "issue" | "pr" | "draft" | "redacted";
  number: number | null;
  repo: string | null;
  title: string;
  /** Issue or draft description, trimmed. Missing on projects cached before the Epic Map. */
  body?: string;
  url: string | null;
  state: "open" | "closed" | "merged";
  stateReason: string | null;
  createdAt: string | null;
  closedAt: string | null;
  updatedAt: string | null;
  labels: string[];
  assignees: string[];
  milestone: Milestone | null;
  issueType: string | null;
  parentKey: string | null;
  subIssues: { total: number; completed: number } | null;
  blockedBy: { key: string; open: boolean; id?: string | null }[];
  archived: boolean;
  fields: Record<string, FieldValue>;
  ids: ItemIds;
}

export interface Project {
  id: string; owner: string; number: number; title: string; url: string; description: string | null;
  fields: FieldDef[]; items: Item[]; loadedAt: string;
  /**
   * The open milestones of the project's repositories, including the ones nothing is in
   * yet: a release you have just made is a release, even before any work is put in it.
   * Missing on projects cached before pm-hub read them.
   */
  milestones?: Milestone[];
}

const BODY_MAX = 2000;
const clipBody = (b: string | null | undefined) => (b ? b.slice(0, BODY_MAX) : undefined);

export const issueKey = (repo: string, number: number) => `${repo}#${number}`;

export function summarizeProjects(data: ViewerProjectsData): ProjectSummary[] {
  const all = [
    ...data.viewer.projectsV2.nodes,
    ...data.viewer.organizations.nodes.flatMap(o => o.projectsV2.nodes.map(p => ({ ...p, owner: { login: o.login } }))),
  ];
  const seen = new Set<string>();
  return all
    .filter(p => p && !seen.has(p.id) && seen.add(p.id))
    .map(p => ({
      id: p.id, owner: p.owner.login ?? data.viewer.login, number: p.number, title: p.title,
      description: p.shortDescription, closed: p.closed, updatedAt: p.updatedAt, url: p.url, itemCount: p.items.totalCount,
    }));
}

function normalizeField(f: RawField): FieldDef | null {
  if (!f || !("id" in f)) return null;
  if (f.__typename === "ProjectV2SingleSelectField") return { kind: "single", id: f.id, name: f.name, dataType: f.dataType, options: f.options };
  if (f.__typename === "ProjectV2IterationField") {
    const c = f.configuration;
    return {
      kind: "iteration", id: f.id, name: f.name, dataType: f.dataType,
      iterations: [
        ...c.completedIterations.map(i => ({ ...i, completed: true })),
        ...c.iterations.map(i => ({ ...i, completed: false })),
      ].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    };
  }
  const kind = f.dataType === "DATE" ? "date" : f.dataType === "NUMBER" ? "number" : f.dataType === "TEXT" ? "text" : "builtin";
  return { kind, id: f.id, name: f.name, dataType: f.dataType };
}

function idMap<T extends { id?: string }>(nodes: T[], keyOf: (n: T) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of nodes) if (n.id) out[keyOf(n)] = n.id;
  return out;
}

export function normalizeItem(raw: RawItem): Item {
  const fields: Record<string, FieldValue> = {};
  for (const v of raw.fieldValues.nodes) {
    if (!v || !("field" in v)) continue;
    const name = (v as { field: { name?: string } | null }).field?.name;
    if (!name) continue;
    switch (v.__typename) {
      case "ProjectV2ItemFieldDateValue": fields[name] = { kind: "date", date: (v as { date: string }).date }; break;
      case "ProjectV2ItemFieldSingleSelectValue": {
        const s = v as { name: string; optionId: string };
        fields[name] = { kind: "single", name: s.name, optionId: s.optionId }; break;
      }
      case "ProjectV2ItemFieldIterationValue": {
        const s = v as { title: string; startDate: string; duration: number; iterationId: string };
        fields[name] = { kind: "iteration", title: s.title, startDate: s.startDate, duration: s.duration, iterationId: s.iterationId }; break;
      }
      case "ProjectV2ItemFieldNumberValue": fields[name] = { kind: "number", number: (v as { number: number }).number }; break;
      case "ProjectV2ItemFieldTextValue": fields[name] = { kind: "text", text: (v as { text: string }).text }; break;
      case "ProjectV2ItemFieldUserValue": fields[name] = { kind: "users", logins: (v as { users: { nodes: { login: string }[] } }).users.nodes.map(u => u.login) }; break;
    }
  }

  const base = {
    id: raw.id, archived: raw.isArchived, fields,
    labels: [] as string[], assignees: [] as string[], milestone: null, issueType: null, parentKey: null,
    subIssues: null, blockedBy: [] as Item["blockedBy"], stateReason: null, ids: emptyIds(),
  };
  const c = raw.content;
  if (!c) return { ...base, key: raw.id, kind: "redacted", number: null, repo: null, title: "(no access)", url: null, state: "open", createdAt: null, closedAt: null, updatedAt: null };

  if (c.__typename === "DraftIssue") {
    return {
      ...base, key: raw.id, kind: "draft", number: null, repo: null, title: c.title, body: clipBody(c.body), url: null, state: "open",
      createdAt: c.createdAt, closedAt: null, updatedAt: c.updatedAt, assignees: c.assignees.nodes.map(a => a.login),
      ids: { ...emptyIds(), content: c.id ?? null, assignees: idMap(c.assignees.nodes, a => a.login) },
    };
  }

  const repo = c.repository.nameWithOwner;
  const common = {
    ...base, key: issueKey(repo, c.number), number: c.number, repo, title: c.title, url: c.url,
    createdAt: c.createdAt, closedAt: c.closedAt, updatedAt: c.updatedAt,
    labels: c.labels.nodes.map(l => l.name), assignees: c.assignees.nodes.map(a => a.login),
    milestone: c.milestone ? { ...c.milestone, id: c.milestone.id ?? null, repo } : null,
    ids: {
      ...emptyIds(), content: c.id ?? null, repo: c.repository.id ?? null,
      labels: idMap(c.labels.nodes, l => l.name), assignees: idMap(c.assignees.nodes, a => a.login),
    },
  };
  if (c.__typename === "PullRequest") {
    return { ...common, kind: "pr", state: c.state === "MERGED" ? "merged" : c.state === "CLOSED" ? "closed" : "open" };
  }
  return {
    ...common, kind: "issue", state: c.state === "CLOSED" ? "closed" : "open", stateReason: c.stateReason, body: clipBody(c.body),
    issueType: c.issueType?.name ?? null,
    parentKey: c.parent ? issueKey(c.parent.repository.nameWithOwner, c.parent.number) : null,
    ids: { ...common.ids, parent: c.parent?.id ?? null },
    subIssues: c.subIssuesSummary && c.subIssuesSummary.total > 0 ? c.subIssuesSummary : null,
    blockedBy: (c.blockedBy?.nodes ?? []).map(b => ({ key: issueKey(b.repository.nameWithOwner, b.number), open: b.state === "OPEN", id: b.id ?? null })),
  };
}

export function normalizeProject(
  owner: string,
  meta: NonNullable<NonNullable<ProjectMetaData["repositoryOwner"]>["projectV2"]>,
  rawItems: RawItem[],
  loadedAt: string,
): Project {
  return {
    id: meta.id, owner, number: meta.number, title: meta.title, url: meta.url, description: meta.shortDescription,
    fields: meta.fields.nodes.map(normalizeField).filter((f): f is FieldDef => f !== null),
    items: rawItems.map(normalizeItem).filter(i => !i.archived),
    loadedAt,
  };
}
