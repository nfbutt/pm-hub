import { describe, expect, it } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { buildSteps, checkStep, endSlip, execute, fetchCurrent, fetchRepoMeta, makeResolver, translate, type RepoMeta } from "../src/github/apply";
import { createClient, type FetchLike } from "../src/github/client";
import type { RawItem } from "../src/github/types";
import { newItem, setOption, setState } from "../src/model/edits";
import { detectMapping } from "../src/model/mapping";
import { normalizeItem, normalizeProject, type Item } from "../src/model/normalize";
import { applyOps, datesOp, netOps, type Op } from "../src/model/ops";

const TODAY = "2026-10-19";
const fixture = makeFixture(TODAY);
const base = normalizeProject(DEMO_OWNER, fixture.meta, fixture.items, TODAY + "T12:00:00Z");
const m = detectMapping(base);
const t = (title: string) => base.items.find(i => i.title === title)!;
const offline = t("Offline mode"), pricing = t("Usage-based pricing engine"), mobile = t("Mobile notifications");
const story = base.items.find(i => i.parentKey === pricing.key && i.state === "open")!;
const orbitStory = base.items.find(i => i.parentKey === offline.key && i.repo === "demo-co/orbit")!;

/** A fake GitHub GraphQL endpoint backed by the fixture. Records every mutation. */
function fakeGitHub(opts: { failing?: string[]; partial?: string[]; edit?: (raw: RawItem) => RawItem } = {}) {
  const calls: { name: string; vars: Record<string, unknown> }[] = [];
  let n = 900;
  const fetchImpl: FetchLike = async (_url, init) => {
    const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
    const name = query.match(/(?:query|mutation) (\w+)/)?.[1] ?? "?";
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "x-oauth-scopes": "project, repo" } });
    if (name === "ItemsById") {
      const ids = variables.ids as string[];
      return json({ data: { nodes: ids.map(id => { const raw = fixture.items.find(r => r.id === id); return raw ? (opts.edit ? opts.edit(structuredClone(raw)) : raw) : null; }), rateLimit: null } });
    }
    if (name === "RepoMeta") {
      const labels = new Map<string, string>(), users = new Map<string, string>();
      for (const i of base.items) { for (const [k, v] of Object.entries(i.ids.labels)) labels.set(k, v); for (const [k, v] of Object.entries(i.ids.assignees)) users.set(k, v); }
      return json({ data: { repository: { id: `R_${variables.name}`, nameWithOwner: `${variables.owner}/${variables.name}`,
        labels: { nodes: [...labels].map(([name, id]) => ({ id, name })) },
        milestones: { nodes: [2, 3, 4].map(k => ({ id: `M_${k}`, title: `Release ${k}`, number: k, dueOn: null, state: "OPEN" })) },
        assignableUsers: { nodes: [...users].map(([login, id]) => ({ id, login })) } }, rateLimit: null } });
    }
    calls.push({ name, vars: variables });
    if (opts.failing?.includes(name)) return json({ errors: [{ type: "FORBIDDEN", message: `${name} was refused` }] });
    if (opts.partial?.includes(name)) return json({ data: { x: null }, errors: [{ message: `${name} partly failed` }] });
    if (name === "CreateIssue") { n++; return json({ data: { createIssue: { issue: { id: `I_new${n}`, number: n, url: `https://github.com/x/${n}` } } } }); }
    if (name === "AddToProject") return json({ data: { addProjectV2ItemById: { item: { id: `PVTI_new_${String(variables.contentId)}` } } } });
    return json({ data: { ok: true } });
  };
  return { client: createClient("t", fetchImpl), calls };
}

async function prepare(ops: Op[], fake = fakeGitHub()) {
  const steps = buildSteps(netOps(ops), k => applyOps(base, ops).project.items.find(i => i.key === k)?.title ?? k);
  const keys = [...new Set(ops.flatMap(o => ["key" in o ? o.key : "", o.kind === "setParent" ? o.after ?? "" : "", o.kind === "addBlockedBy" ? o.blocker : ""]))].filter(Boolean);
  const current = await fetchCurrent(fake.client, base, keys);
  const repos = new Map<string, RepoMeta>([["demo-co/orbit", await fetchRepoMeta(fake.client, "demo-co/orbit")], ["demo-co/orbit-api", await fetchRepoMeta(fake.client, "demo-co/orbit-api")]]);
  for (const s of steps) { const c = checkStep(s.op, "key" in s.op ? current.get(s.op.key) : undefined); if (s.status === "ready") { s.status = c.status; s.message = c.theirs; } }
  return { steps, current, repos, ...fake };
}

describe("translate", () => {
  const r = makeResolver(base, new Map(), new Map([["demo-co/orbit", { id: "R_orbit", labels: { "type: epic": "L_e", "risky": "L_r", "type: story": "L_s", "product: mobile": "L_m", "product: web": "L_w" }, milestones: { "Release 3": "M_3" }, users: { zoe: "U_zoe" } }]]), new Map());
  const names = (op: Op) => translate(op, r).map(c => c.name);

  it("maps each change to the right GitHub calls", () => {
    expect(names(datesOp(offline, m, "2027-01-04", "2027-02-26"))).toEqual(["SetField", "SetField"]);
    expect(translate(datesOp(offline, m, "2027-01-04", "2027-02-26"), r)[0]!.vars).toMatchObject({ projectId: "PVT_demo", itemId: offline.id, fieldId: "f-start", value: { date: "2027-01-04" } });
    expect(translate(setOption(base, offline, "Priority", "High")[0]!, r)[0]!.vars).toMatchObject({ value: { singleSelectOptionId: "p1" } });
    expect(names({ kind: "setField", key: offline.key, field: "Priority", before: offline.fields["Priority"]!, after: null })).toEqual(["ClearField"]);
    expect(names({ kind: "setTitle", key: offline.key, before: "a", after: "b" })).toEqual(["UpdateIssue"]);
    expect(translate(setState(story, "closed", "NOT_PLANNED")[0]!, r)[0]!.vars).toEqual({ issueId: story.ids.content, stateReason: "NOT_PLANNED" });
    expect(translate({ kind: "setParent", key: story.key, before: pricing.key, after: offline.key }, r)[0]!).toMatchObject({ name: "AddSubIssue", vars: { issueId: offline.ids.content, subIssueId: story.ids.content } });
    expect(names({ kind: "setParent", key: story.key, before: pricing.key, after: null })).toEqual(["RemoveSubIssue"]);
    expect(translate({ kind: "setLabels", key: offline.key, before: offline.labels, after: [...offline.labels.filter(l => l !== "product: mobile"), "product: web"] }, r).map(c => [c.name, c.vars.labelIds]))
      .toEqual([["AddLabels", ["L_w"]], ["RemoveLabels", ["L_m"]]]);
    expect(translate({ kind: "setMilestone", key: orbitStory.key, before: orbitStory.milestone, after: { title: "Release 3", number: 3, dueOn: null, state: "OPEN", repo: "demo-co/orbit" } }, r)[0]!.vars).toEqual({ id: orbitStory.ids.content, milestoneId: "M_3" });
    expect(translate({ kind: "addBlockedBy", key: offline.key, blocker: mobile.key }, r)[0]!).toMatchObject({ name: "AddBlockedBy", vars: { issueId: offline.ids.content, blockingIssueId: mobile.ids.content } });
    expect(names({ kind: "archive", key: offline.key })).toEqual(["ArchiveItem"]);
    expect(names({ kind: "park", key: offline.key, before: false, after: true })).toEqual([]);
  });

  it("explains changes that can't be made", () => {
    expect(() => translate({ kind: "setLabels", key: offline.key, before: [], after: ["no-such-label"] }, r)).toThrow(/doesn't exist/);
    expect(() => translate({ kind: "setMilestone", key: orbitStory.key, before: null, after: { title: "Release 9", number: 9, dueOn: null, state: "OPEN", repo: "demo-co/orbit" } }, r)).toThrow(/no open milestone/);
    const draft = base.items.find(i => i.kind === "draft")!;
    expect(() => translate({ kind: "setTitle", key: draft.key, before: "a", after: "b" }, r)).toThrow(/Draft items/);
  });
});

describe("conflict check", () => {
  it("is ready when GitHub still has the before value, already-done when it has the after value, otherwise a conflict", () => {
    const op = datesOp(offline, m, "2027-01-04", "2027-02-26");
    expect(checkStep(op, offline).status).toBe("ready");
    expect(checkStep(op, applyOps(base, [op]).project.items.find(i => i.key === offline.key)).status).toBe("already");
    const theirs = applyOps(base, [datesOp(offline, m, "2026-12-01", "2027-01-15")]).project.items.find(i => i.key === offline.key)!;
    expect(checkStep(op, theirs)).toEqual({ status: "conflict", theirs: "dates 2026-12-01 – 2027-01-15" });
    expect(checkStep({ kind: "setTitle", key: offline.key, before: "Offline mode", after: "x" }, { ...offline, title: "Renamed by someone" })).toMatchObject({ status: "conflict" });
  });

  it("detects a change made on GitHub after loading", async () => {
    const ops = setOption(base, offline, "Priority", "High");
    const fake = fakeGitHub({ edit: raw => {
      if (raw.id !== offline.id) return raw;
      raw.fieldValues.nodes = raw.fieldValues.nodes.map(v => ("field" in v && v.field?.name === "Priority" ? { ...v, name: "Critical", optionId: "p0" } : v));
      return raw;
    } });
    const { steps } = await prepare(ops, fake);
    expect(steps[0]).toMatchObject({ status: "conflict", message: "Priority is Critical" });
  });
});

describe("execute", () => {
  it("creates new items first, resolves their keys, and applies everything", async () => {
    const epicOp = newItem(base, m, "Sync conflicts", { epic: true })[0]!;
    const withEpic = applyOps(base, [epicOp]).project;
    const storyOp = newItem(withEpic, m, "Merge rules", { parentKey: (epicOp as Extract<Op, { kind: "create" }>).key })[0]!;
    // Recorded child first, to prove creates are re-ordered parent-first.
    const ops: Op[] = [storyOp, epicOp, datesOp(offline, m, "2027-01-04", "2027-02-26"), ...setOption(base, offline, "Priority", "High"),
      { kind: "setParent", key: story.key, before: pricing.key, after: offline.key }, { kind: "addBlockedBy", key: offline.key, blocker: mobile.key }];
    const p = await prepare(ops);
    const res = await execute(p.client, base, p.steps, p.current, p.repos);
    expect(res.steps.map(s => s.status)).toEqual(res.steps.map(() => "applied"));
    const createIssues = p.calls.filter(c => c.name === "CreateIssue");
    expect(createIssues.map(c => c.vars.title)).toEqual(["Sync conflicts", "Merge rules"]);
    expect(createIssues[1]!.vars.parentIssueId).toBe(res.created.get((epicOp as Extract<Op, { kind: "create" }>).key)!.contentId);
    expect(p.calls.findIndex(c => c.name === "SetField")).toBeGreaterThan(p.calls.findIndex(c => c.name === "CreateIssue"));
  });

  it("keeps going when one change fails, and reports which", async () => {
    const ops: Op[] = [datesOp(offline, m, "2027-01-04", "2027-02-26"), { kind: "addBlockedBy", key: offline.key, blocker: mobile.key }];
    const p = await prepare(ops, fakeGitHub({ failing: ["AddBlockedBy"] }));
    const res = await execute(p.client, base, p.steps, p.current, p.repos);
    expect(res.steps.map(s => [s.op.kind, s.status])).toEqual([["setDates", "applied"], ["addBlockedBy", "failed"]]);
    expect(res.steps[1]!.message).toBe("AddBlockedBy was refused");
  });

  it("treats a mutation that returns partial data with errors as failed", async () => {
    const p = await prepare([{ kind: "setTitle", key: offline.key, before: offline.title, after: "x" }], fakeGitHub({ partial: ["UpdateIssue"] }));
    const res = await execute(p.client, base, p.steps, p.current, p.repos);
    expect(res.steps[0]).toMatchObject({ status: "failed", message: "UpdateIssue partly failed" });
  });

  it("posts the reason for a slipped date as a comment", async () => {
    const op = datesOp(offline, m, "2027-01-04", "2027-03-26");
    const p = await prepare([op]);
    p.steps[0]!.reason = "waiting on the sync API";
    await execute(p.client, base, p.steps, p.current, p.repos);
    const comment = p.calls.find(c => c.name === "AddComment")!;
    expect(comment.vars.subjectId).toBe(offline.ids.content);
    expect(comment.vars.body).toBe("**Target date moved** 2027-01-24 → 2027-03-26 (+61 days): waiting on the sync API\n\n<sub>Recorded with pm-hub</sub>");
    expect(endSlip(op)).toBeGreaterThan(3);
  });

  it("dry run sends nothing", async () => {
    const p = await prepare([datesOp(offline, m, "2027-01-04", "2027-02-26")]);
    const res = await execute(p.client, base, p.steps, p.current, p.repos, { dryRun: true });
    expect(p.calls).toEqual([]);
    expect(res.calls.map(c => c.name)).toEqual(["SetField", "SetField"]);
  });

  it("skips unticked changes and leaves local ones alone", async () => {
    const ops: Op[] = [datesOp(offline, m, "2027-01-04", "2027-02-26"), { kind: "park", key: mobile.key, before: false, after: true }];
    const p = await prepare(ops);
    p.steps[0]!.include = false;
    const res = await execute(p.client, base, p.steps, p.current, p.repos);
    expect(res.steps.map(s => s.status)).toEqual(["skipped", "local"]);
    expect(p.calls).toEqual([]);
  });

  it("marks changes GitHub already has as applied without writing", async () => {
    const op = { kind: "addBlockedBy", key: t("Public REST API v2").key, blocker: pricing.key } as Op; // already true in the fixture
    const p = await prepare([op]);
    expect(p.steps[0]!.status).toBe("already");
    const res = await execute(p.client, base, p.steps, p.current, p.repos);
    expect(res.steps[0]).toMatchObject({ status: "applied", message: "Already like this on GitHub." });
    expect(p.calls).toEqual([]);
  });
});

describe("normalizing re-read items", () => {
  it("re-reads give the same item as the full load", () => {
    const raw = fixture.items.find(r => r.id === offline.id)!;
    const again: Item = normalizeItem(raw);
    expect(again).toEqual(offline);
  });
});
