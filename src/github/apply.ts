// Turns reviewed changes into GitHub writes: a conflict check against what GitHub has now,
// then ordered, per-change execution with results. The only caller of mutations.ts.
import type { GitHubClient } from "./client";
import { GitHubError } from "./client";
import {
  ADD_BLOCKED_BY, ADD_COMMENT, ADD_LABELS, ADD_SUB_ISSUE, ADD_TO_PROJECT, ARCHIVE_ITEM, CLEAR_FIELD, CLOSE_ISSUE, CREATE_ISSUE,
  CREATE_STATUS_UPDATE, REMOVE_BLOCKED_BY, REMOVE_LABELS, REMOVE_SUB_ISSUE, REOPEN_ISSUE, SET_FIELD, UNARCHIVE_ITEM, UPDATE_ISSUE,
} from "./mutations";
import { ITEMS_BY_ID, REPO_META } from "./queries";
import type { RawItem } from "./types";
import { emptyIds, normalizeItem, type FieldValue, type Item, type Project } from "../model/normalize";
import { describe as describeOp, fmtValue, isNewKey, LOCAL_ONLY, slotOf, type Op } from "../model/ops";

export interface Call { doc: string; name: string; vars: Record<string, unknown>; note?: string }

export interface RepoMeta { id: string; labels: Record<string, string>; milestones: Record<string, string>; users: Record<string, string> }

export class ApplyError extends Error {}

/** Everything translate() needs to know about ids. */
export interface Resolver {
  projectId: string;
  itemId(key: string): string;
  contentId(key: string): string;
  item(key: string): Item | undefined;
  fieldId(name: string): string;
  optionId(field: string, name: string): string;
  repo(name: string | null): RepoMeta;
}

const mutationName = (doc: string) => doc.match(/mutation (\w+)/)?.[1] ?? "Mutation";
const call = (doc: string, vars: Record<string, unknown>, note?: string): Call => ({ doc, name: mutationName(doc), vars, note });

function fieldValueInput(r: Resolver, field: string, v: FieldValue): Record<string, unknown> {
  switch (v.kind) {
    case "date": return { date: v.date.slice(0, 10) };
    case "single": return { singleSelectOptionId: r.optionId(field, v.name) };
    case "iteration": return { iterationId: v.iterationId };
    case "number": return { number: v.number };
    case "text": return { text: v.text };
    case "users": throw new ApplyError(`“${field}” holds people; change owners instead.`);
  }
}

function needIssue(item: Item | undefined, what: string): Item {
  if (!item) throw new ApplyError("This item is no longer in the project.");
  if (item.kind === "draft") throw new ApplyError(`Draft items can't ${what} from pm-hub yet. Convert it to an issue on GitHub first.`);
  if (item.kind === "pr" && /close|reopen|parent|blocked/.test(what)) throw new ApplyError(`Pull requests can't ${what}.`);
  if (item.kind === "redacted") throw new ApplyError("Your token can't see this item.");
  return item;
}

/** The GitHub calls for one change (excluding creates, which depend on ids made at run time). */
export function translate(op: Op, r: Resolver): Call[] {
  const projectId = r.projectId;
  switch (op.kind) {
    case "setDates": {
      const out: Call[] = [];
      for (const which of ["start", "end"] as const) {
        const field = op.fields[which];
        if (!field || op.before[which] === op.after[which]) continue;
        const value = op.after[which];
        out.push(value
          ? call(SET_FIELD, { projectId, itemId: r.itemId(op.key), fieldId: r.fieldId(field), value: { date: value } })
          : call(CLEAR_FIELD, { projectId, itemId: r.itemId(op.key), fieldId: r.fieldId(field) }));
      }
      return out;
    }
    case "setField":
      return [op.after
        ? call(SET_FIELD, { projectId, itemId: r.itemId(op.key), fieldId: r.fieldId(op.field), value: fieldValueInput(r, op.field, op.after) })
        : call(CLEAR_FIELD, { projectId, itemId: r.itemId(op.key), fieldId: r.fieldId(op.field) })];
    case "setTitle": needIssue(r.item(op.key), "be renamed"); return [call(UPDATE_ISSUE, { id: r.contentId(op.key), title: op.after })];
    case "setState": {
      const item = needIssue(r.item(op.key), op.after.state === "closed" ? "be closed" : "be reopened");
      if (op.after.state === "open") return [call(REOPEN_ISSUE, { issueId: r.contentId(item.key) })];
      return [call(CLOSE_ISSUE, { issueId: r.contentId(item.key), stateReason: op.after.reason === "NOT_PLANNED" ? "NOT_PLANNED" : op.after.reason === "DUPLICATE" ? "DUPLICATE" : "COMPLETED" })];
    }
    case "setParent": {
      needIssue(r.item(op.key), "change parent");
      if (op.after) return [call(ADD_SUB_ISSUE, { issueId: r.contentId(op.after), subIssueId: r.contentId(op.key) })];
      if (!op.before) return [];
      return [call(REMOVE_SUB_ISSUE, { issueId: r.contentId(op.before), subIssueId: r.contentId(op.key) })];
    }
    case "setLabels": {
      const item = needIssue(r.item(op.key), "change labels");
      const meta = r.repo(item.repo);
      const ids = (names: string[]) => names.map(n => { const id = meta.labels[n] ?? item.ids.labels[n]; if (!id) throw new ApplyError(`The label “${n}” doesn't exist in ${item.repo}. Create it on GitHub first.`); return id; });
      const add = op.after.filter(l => !op.before.includes(l)), remove = op.before.filter(l => !op.after.includes(l));
      const out: Call[] = [];
      if (add.length) out.push(call(ADD_LABELS, { labelableId: r.contentId(op.key), labelIds: ids(add) }));
      if (remove.length) out.push(call(REMOVE_LABELS, { labelableId: r.contentId(op.key), labelIds: ids(remove) }));
      return out;
    }
    case "setMilestone": {
      const item = needIssue(r.item(op.key), "change release");
      let milestoneId: string | null = null;
      if (op.after) {
        milestoneId = r.repo(item.repo).milestones[op.after.title] ?? (op.after.repo === item.repo ? op.after.id ?? null : null);
        if (!milestoneId) throw new ApplyError(`${item.repo} has no open milestone called “${op.after.title}”.`);
      }
      return [call(UPDATE_ISSUE, { id: r.contentId(op.key), milestoneId })];
    }
    case "setAssignees": {
      const item = needIssue(r.item(op.key), "change owners");
      const meta = r.repo(item.repo);
      const assigneeIds = op.after.map(l => { const id = meta.users[l] ?? item.ids.assignees[l]; if (!id) throw new ApplyError(`${l} can't be assigned in ${item.repo}.`); return id; });
      return [call(UPDATE_ISSUE, { id: r.contentId(op.key), assigneeIds })];
    }
    case "addBlockedBy":
      needIssue(r.item(op.key), "be blocked");
      return [call(ADD_BLOCKED_BY, { issueId: r.contentId(op.key), blockingIssueId: r.contentId(op.blocker) })];
    case "removeBlockedBy":
      return [call(REMOVE_BLOCKED_BY, { issueId: r.contentId(op.key), blockingIssueId: r.contentId(op.blocker) })];
    case "archive": return [call(ARCHIVE_ITEM, { projectId, itemId: op.itemId ?? r.itemId(op.key) })];
    case "unarchive": return [call(UNARCHIVE_ITEM, { projectId, itemId: op.itemId ?? r.itemId(op.key) })];
    case "create": return []; // run-time only: see execute()
    case "park": case "reorder": return [];
  }
}

// ---------------------------------------------------------------- review steps

export type StepStatus = "ready" | "local" | "conflict" | "already" | "applying" | "applied" | "failed" | "skipped";

export interface Step {
  id: string;
  op: Op;
  label: string;
  include: boolean;
  status: StepStatus;
  /** For conflicts: what GitHub has now. For failures: GitHub's message. */
  message?: string;
  /** Optional "why" for date moves, posted as an issue comment. */
  reason?: string;
}

export function buildSteps(ops: Op[], titleOf: (k: string) => string): Step[] {
  return ops.map((op, i) => ({
    id: `${i}:${slotOf(op)}`, op, label: describeOp(op, titleOf),
    include: !LOCAL_ONLY.has(op.kind), status: LOCAL_ONLY.has(op.kind) ? "local" : "ready",
  }));
}

/** Days an end date moved; reasons are asked for when this is more than 3. */
export function endSlip(op: Op): number {
  if (op.kind !== "setDates" || !op.before.end || !op.after.end) return 0;
  return Math.round((Date.parse(op.after.end) - Date.parse(op.before.end)) / 86_400_000);
}

// ---------------------------------------------------------------- preflight

const norm = (v: unknown) => JSON.stringify(v ?? null);
function fieldEq(a: FieldValue | null | undefined, b: FieldValue | null | undefined) {
  if (!a || !b) return !a && !b;
  if (a.kind === "single" && b.kind === "single") return a.name === b.name;
  if (a.kind === "date" && b.kind === "date") return a.date.slice(0, 10) === b.date.slice(0, 10);
  if (a.kind === "iteration" && b.kind === "iteration") return a.iterationId === b.iterationId;
  return norm(a) === norm(b);
}
const dateOf = (i: Item, f: string | null) => { if (!f) return null; const v = i.fields[f]; return v?.kind === "date" ? v.date.slice(0, 10) : null; };
const sameSet = (a: string[], b: string[]) => norm([...a].sort()) === norm([...b].sort());

/** Compares a change's "before" with what GitHub has now. */
export function checkStep(op: Op, now: Item | undefined): { status: "ready" | "conflict" | "already"; theirs?: string } {
  if (isNewKey("key" in op ? op.key : "")) return { status: "ready" };
  // An item that was taken out of the project is not in the project any more, so the
  // rollback carries the id GitHub knows it by. It is still there, so it can go back.
  if (op.kind === "unarchive" && op.itemId) return { status: "ready" };
  if (!now) return op.kind === "archive" ? { status: "already" } : { status: "conflict", theirs: "removed from the project" };
  const verdict = (matchesBefore: boolean, matchesAfter: boolean, theirs: string) =>
    matchesAfter ? { status: "already" as const } : matchesBefore ? { status: "ready" as const } : { status: "conflict" as const, theirs };
  switch (op.kind) {
    case "setDates": {
      const s = dateOf(now, op.fields.start), e = dateOf(now, op.fields.end);
      const cur = { start: op.fields.start ? s : op.before.start, end: op.fields.end ? e : op.before.end };
      return verdict(norm(cur) === norm(op.before), norm(cur) === norm({ start: op.fields.start ? op.after.start : op.before.start, end: op.fields.end ? op.after.end : op.before.end }),
        `dates ${s ?? "none"} – ${e ?? "none"}`);
    }
    case "setField": return verdict(fieldEq(now.fields[op.field], op.before), fieldEq(now.fields[op.field], op.after), `${op.field} is ${fmtValue(now.fields[op.field] ?? null)}`);
    case "setTitle": return verdict(now.title === op.before, now.title === op.after, `title is “${now.title}”`);
    case "setState": { const st = now.state === "open" ? "open" : "closed"; return verdict(st === op.before.state, st === op.after.state, `it is ${now.state}`); }
    case "setParent": return verdict(now.parentKey === op.before, now.parentKey === op.after, now.parentKey ? "it's under another epic" : "it's not under an epic");
    case "setLabels": return verdict(sameSet(now.labels, op.before), sameSet(now.labels, op.after), `labels are ${now.labels.join(", ") || "none"}`);
    case "setMilestone": return verdict((now.milestone?.title ?? null) === (op.before?.title ?? null), (now.milestone?.title ?? null) === (op.after?.title ?? null), `release is ${now.milestone?.title ?? "none"}`);
    case "setAssignees": return verdict(sameSet(now.assignees, op.before), sameSet(now.assignees, op.after), `owners are ${now.assignees.join(", ") || "nobody"}`);
    case "addBlockedBy": return now.blockedBy.some(b => b.key === op.blocker) ? { status: "already" } : { status: "ready" };
    case "removeBlockedBy": return now.blockedBy.some(b => b.key === op.blocker) ? { status: "ready" } : { status: "already" };
    case "archive": return now.archived ? { status: "already" } : { status: "ready" };
    case "unarchive": return { status: "ready" };
    default: return { status: "ready" };
  }
}

/**
 * Checks the steps again against what GitHub has now, so a change made between the
 * check and the apply is not overwritten. The steps that no longer match are turned into
 * conflicts and left out.
 */
export function recheck(steps: Step[], current: Map<string, Item>): { steps: Step[]; changed: number } {
  let changed = 0;
  const out = steps.map(s => {
    if (s.status !== "ready" && s.status !== "failed") return s;
    const c = checkStep(s.op, "key" in s.op ? current.get(s.op.key) : undefined);
    if (c.status !== "conflict") return s;
    changed++;
    return { ...s, status: "conflict" as const, message: c.theirs, include: false };
  });
  return { steps: out, changed };
}

/** Keys whose current GitHub state (and ids) the apply needs. */
export function involvedKeys(ops: Op[]): string[] {
  const keys = new Set<string>();
  for (const op of ops) {
    if ("key" in op) keys.add(op.key);
    if (op.kind === "setParent") { if (op.before) keys.add(op.before); if (op.after) keys.add(op.after); }
    if (op.kind === "addBlockedBy" || op.kind === "removeBlockedBy") keys.add(op.blocker);
    if (op.kind === "create" && op.item.parentKey) keys.add(op.item.parentKey);
  }
  return [...keys].filter(k => !isNewKey(k));
}

/**
 * Re-reads the affected items from GitHub. Returns them keyed by item key.
 * Items that were taken out of the project are included: they still exist on GitHub and a
 * rollback may have to put them back, so their ids are fetched by the ids the rollback
 * carries.
 */
export async function fetchCurrent(client: GitHubClient, base: Project, keys: string[], extra: { key: string; id: string }[] = []): Promise<Map<string, Item>> {
  const wanted = new Map<string, string>();
  for (const k of keys) { const id = base.items.find(i => i.key === k)?.id; if (id) wanted.set(k, id); }
  for (const e of extra) wanted.set(e.key, e.id);
  const ids = [...new Set(wanted.values())];
  const out = new Map<string, Item>();
  for (let i = 0; i < ids.length; i += 50) {
    const data = await client.query<{ nodes: (RawItem | null)[] }>(ITEMS_BY_ID, { ids: ids.slice(i, i + 50) });
    for (const raw of data.nodes) if (raw && "fieldValues" in raw) { const item = normalizeItem(raw); out.set(item.key, item); }
  }
  return out;
}

/** Items taken out of the project: their ids have to be fetched to be addressed. */
export function archivedIds(ops: Op[]): { key: string; id: string }[] {
  const out: { key: string; id: string }[] = [];
  for (const op of ops) if ((op.kind === "archive" || op.kind === "unarchive") && op.itemId) out.push({ key: op.key, id: op.itemId });
  return out;
}

export async function fetchRepoMeta(client: GitHubClient, repo: string): Promise<RepoMeta> {
  const [owner, name] = repo.split("/");
  const data = await client.query<{ repository: { id: string; labels: { nodes: { id: string; name: string }[] }; milestones: { nodes: { id: string; title: string }[] }; assignableUsers: { nodes: { id: string; login: string }[] } } | null }>(REPO_META, { owner, name });
  if (!data.repository) throw new ApplyError(`Repository ${repo} wasn't found.`);
  const r = data.repository;
  return {
    id: r.id,
    labels: Object.fromEntries(r.labels.nodes.map(l => [l.name, l.id])),
    milestones: Object.fromEntries(r.milestones.nodes.map(m => [m.title, m.id])),
    users: Object.fromEntries(r.assignableUsers.nodes.map(u => [u.login, u.id])),
  };
}

// ---------------------------------------------------------------- execute

export interface Created { contentId: string; itemId: string; number: number; url: string; repo: string | null; title: string }

export function makeResolver(base: Project, current: Map<string, Item>, repos: Map<string, RepoMeta>, created: Map<string, Created>): Resolver {
  const find = (key: string) => current.get(key) ?? base.items.find(i => i.key === key);
  return {
    projectId: base.id,
    item: key => {
      const c = created.get(key);
      if (!c) return find(key);
      // A just-created issue: enough of an Item for later changes in the same apply.
      return {
        id: c.itemId, key, kind: "issue", number: c.number, repo: c.repo, title: c.title, url: c.url, state: "open", stateReason: null,
        createdAt: null, closedAt: null, updatedAt: null, labels: [], assignees: [], milestone: null, issueType: null, parentKey: null,
        subIssues: null, blockedBy: [], archived: false, fields: {}, ids: { ...emptyIds(), content: c.contentId },
      };
    },
    itemId: key => { const c = created.get(key); if (c) return c.itemId; const i = find(key); if (!i?.id) throw new ApplyError(`No project item for ${key}.`); return i.id; },
    contentId: key => { const c = created.get(key); if (c) return c.contentId; const id = find(key)?.ids.content; if (!id) throw new ApplyError(`GitHub id for ${key} is unknown. Refresh and try again.`); return id; },
    fieldId: name => { const f = base.fields.find(x => x.name === name); if (!f) throw new ApplyError(`The project has no field called “${name}”.`); return f.id; },
    optionId: (field, name) => {
      const f = base.fields.find(x => x.name === field);
      const o = f?.kind === "single" ? f.options.find(x => x.name === name) : undefined;
      if (!o) throw new ApplyError(`“${field}” has no option “${name}”.`);
      return o.id;
    },
    repo: name => { const m = name ? repos.get(name) : undefined; if (!m) throw new ApplyError(`Details for ${name ?? "this repository"} weren't loaded.`); return m; },
  };
}

export interface ExecOptions {
  onStep?: (step: Step) => void;
  /** Max changes in flight at once. */
  concurrency?: number;
  dryRun?: boolean;
}

export interface ExecResult { steps: Step[]; created: Map<string, Created>; calls: Call[] }

async function runCalls(client: GitHubClient, calls: Call[], log: Call[], dryRun: boolean) {
  const results: unknown[] = [];
  for (const c of calls) {
    log.push(c);
    if (!dryRun) results.push(await client.mutate(c.doc, c.vars));
  }
  return results;
}

/** Applies the included steps in order: creates (parents first), then everything else a few at a time. */
export async function execute(client: GitHubClient, base: Project, steps: Step[], current: Map<string, Item>, repos: Map<string, RepoMeta>, opts: ExecOptions = {}): Promise<ExecResult> {
  const created = new Map<string, Created>();
  const log: Call[] = [];
  const r = makeResolver(base, current, repos, created);
  const update = (s: Step, patch: Partial<Step>) => { Object.assign(s, patch); opts.onStep?.(s); };
  const todo = steps.filter(s => s.include && (s.status === "ready" || s.status === "failed"));
  for (const s of steps) if (!s.include && s.status !== "local") update(s, { status: "skipped" });
  for (const s of steps) if (s.include && s.status === "already") update(s, { status: "applied", message: "Already like this on GitHub." });

  // Creates first, parents before children.
  const creates = todo.filter(s => s.op.kind === "create");
  const createdKeys = new Set(creates.map(s => (s.op as Extract<Op, { kind: "create" }>).key));
  creates.sort((a, b) => {
    const pa = (a.op as Extract<Op, { kind: "create" }>).item.parentKey, pb = (b.op as Extract<Op, { kind: "create" }>).item.parentKey;
    return Number(!!pa && createdKeys.has(pa)) - Number(!!pb && createdKeys.has(pb));
  });
  for (const s of creates) {
    const op = s.op as Extract<Op, { kind: "create" }>;
    update(s, { status: "applying" });
    try {
      const meta = r.repo(op.item.repo);
      const labelIds = op.item.labels.map(l => meta.labels[l]).filter(Boolean);
      const parentIssueId = op.item.parentKey ? r.contentId(op.item.parentKey) : null;
      const createCall = call(CREATE_ISSUE, { repositoryId: meta.id, title: op.item.title, labelIds, parentIssueId });
      log.push(createCall);
      if (opts.dryRun) { created.set(op.key, { contentId: `<new ${op.item.title}>`, itemId: `<new item ${op.item.title}>`, number: 0, url: "", repo: op.item.repo, title: op.item.title }); update(s, { status: "applied", message: "Dry run" }); continue; }
      const res = await client.mutate<{ createIssue: { issue: { id: string; number: number; url: string } } }>(createCall.doc, createCall.vars);
      const issue = res.createIssue.issue;
      log.push(call(ADD_TO_PROJECT, { projectId: base.id, contentId: issue.id }));
      const added = await client.mutate<{ addProjectV2ItemById: { item: { id: string } } }>(ADD_TO_PROJECT, { projectId: base.id, contentId: issue.id });
      created.set(op.key, { contentId: issue.id, itemId: added.addProjectV2ItemById.item.id, number: issue.number, url: issue.url, repo: op.item.repo, title: op.item.title });
      for (const [field, value] of Object.entries(op.item.fields)) {
        await runCalls(client, [call(SET_FIELD, { projectId: base.id, itemId: created.get(op.key)!.itemId, fieldId: r.fieldId(field), value: fieldValueInput(r, field, value) })], log, false);
      }
      update(s, { status: "applied", message: `Created #${issue.number}` });
    } catch (e) {
      update(s, { status: "failed", message: errorText(e) });
    }
  }

  // Everything else, a few at a time. Changes to an item whose create failed are skipped.
  const rest = todo.filter(s => s.op.kind !== "create");
  const failedCreates = new Set(creates.filter(s => s.status === "failed").map(s => (s.op as Extract<Op, { kind: "create" }>).key));
  let next = 0;
  const worker = async () => {
    while (next < rest.length) {
      const s = rest[next++]!;
      const keys = involvedKeys([s.op]).concat("key" in s.op ? [s.op.key] : []);
      if (keys.some(k => failedCreates.has(k)) || ("key" in s.op && failedCreates.has(s.op.key))) { update(s, { status: "failed", message: "Its new item couldn't be created." }); continue; }
      update(s, { status: "applying" });
      try {
        await runCalls(client, translate(s.op, r), log, !!opts.dryRun);
        if (s.reason && s.op.kind === "setDates") {
          const slip = endSlip(s.op);
          const body = `**Target date moved** ${s.op.before.end} → ${s.op.after.end} (${slip > 0 ? "+" : ""}${slip} days): ${s.reason}\n\n<sub>Recorded with pm-hub</sub>`;
          await runCalls(client, [call(ADD_COMMENT, { subjectId: r.contentId(s.op.key), body })], log, !!opts.dryRun);
        }
        update(s, { status: "applied", message: opts.dryRun ? "Dry run" : undefined });
      } catch (e) {
        update(s, { status: "failed", message: errorText(e) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 3) }, worker));
  return { steps, created, calls: log };
}

export async function postStatusUpdate(client: GitHubClient, projectId: string, status: "ON_TRACK" | "AT_RISK" | "OFF_TRACK" | "COMPLETE" | "INACTIVE", body: string) {
  return client.mutate(CREATE_STATUS_UPDATE, { projectId, status, body });
}

function errorText(e: unknown): string {
  if (e instanceof ApplyError) return e.message;
  if (e instanceof GitHubError) {
    const details = Array.isArray(e.detail) ? (e.detail as { message?: string }[]).map(d => d.message).filter(Boolean).join("; ") : "";
    return details || e.message;
  }
  return e instanceof Error ? e.message : "Unknown error";
}
