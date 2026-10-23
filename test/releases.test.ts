// Releases as a plan of epics: what the releases are, which epics are in each, moving an
// epic (and its work) between them, making a release and changing its date, and writing
// those changes to GitHub's milestones.
import { describe, expect, it } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { buildSteps, execute, type RepoMeta } from "../src/github/apply";
import { createClient, type FetchLike } from "../src/github/client";
import { detectMapping, releaseOf } from "../src/model/mapping";
import { normalizeProject } from "../src/model/normalize";
import { applyOps, describe as describeOp, inverseOps, netOps, type Op } from "../src/model/ops";
import { buildPlan } from "../src/model/plan/cpm";
import {
  checkPlacements, createRelease, epicRelease, fittingReleases, listReleases, moveEpicToRelease, releaseAbilities, releaseBoard, setReleaseDue, workOf,
} from "../src/model/releases";
import { buildSchedule } from "../src/model/schedule";
import { checkPlacementAnswer, promptPlacement } from "../src/ai/epics";

const TODAY = "2026-10-19";
const f = makeFixture(TODAY);
const project = normalizeProject(DEMO_OWNER, f.meta, f.items, TODAY + "T12:00:00Z");
const mapping = detectMapping(project);
const epic = (title: string) => project.items.find(i => i.title === title)!;
const release = (title: string, p = project) => listReleases(p, mapping).find(r => r.title === title)!;
const planOf = (p = project) => buildPlan(p, mapping, buildSchedule(p, mapping));

describe("the releases", () => {
  it("are the project's milestones, in the order they are due, with the repositories they are in", () => {
    const list = listReleases(project, mapping);
    expect(list.map(r => r.title)).toEqual(["Release 1", "Release 2", "Release 3", "Release 4"]);
    expect(list.map(r => r.due)).toEqual([...list.map(r => r.due)].sort());
    expect(release("Release 2").repos.length).toBeGreaterThan(0);
    expect(release("Release 1").closed).toBe(true);
  });

  it("include a release nothing is in yet", () => {
    const withEmpty = { ...project, milestones: [{ id: "M_9", title: "Release 9", number: 9, dueOn: "2027-06-01T12:00:00Z", state: "OPEN", repo: "demo-co/orbit" }] };
    expect(listReleases(withEmpty, mapping).map(r => r.title)).toContain("Release 9");
  });

  it("say what can be changed about them", () => {
    expect(releaseAbilities(mapping)).toMatchObject({ create: true, date: true });
    expect(releaseAbilities({ ...mapping, release: { kind: "iteration", field: "Sprint" } })).toMatchObject({ create: false, date: false });
  });
});

describe("the board", () => {
  const board = releaseBoard(project, mapping, buildSchedule(project, mapping), planOf(), TODAY);

  it("puts every open epic in exactly one column", () => {
    const open = project.items.filter(i => i.state === "open" && i.title && board.columns.some(c => c.epics.some(e => e.key === i.key)));
    const placed = board.columns.flatMap(c => c.epics.map(e => e.key));
    expect(new Set(placed).size).toBe(placed.length);
    expect(open.length).toBeGreaterThan(3);
  });

  it("places an epic with no release of its own where most of its work is", () => {
    const billing = epic("Billing and invoices");
    const col = board.columns.find(c => c.epics.some(e => e.key === billing.key))!;
    expect(col.release?.title).toBe(epicRelease(project, mapping, billing)!.title);
    expect(col.epics.find(e => e.key === billing.key)!.own).toBe(false);
  });

  it("counts the stories and says when a release cannot make its date", () => {
    for (const c of board.columns) expect(c.done).toBeLessThanOrEqual(c.total);
    const late = board.problems.filter(p => p.kind === "late");
    expect(late.length).toBeGreaterThan(0);
    expect(late[0]!.fix?.ops.length).toBeGreaterThan(0);
    expect(board.columns.some(c => c.status === "at-risk")).toBe(true);
  });

  it("finds an epic that ships before something it waits for", () => {
    // REST API v2 waits for the pricing engine; put the API in an earlier release.
    const api = epic("Public REST API v2");
    const moved = applyOps(project, moveEpicToRelease(project, mapping, api, release("Release 2"))).project;
    const b = releaseBoard(moved, mapping, buildSchedule(moved, mapping), planOf(moved), TODAY);
    const order = b.problems.find(p => p.kind === "order" && p.keys[0] === api.key);
    expect(order?.message).toMatch(/waits for/);
    // It also has to finish before anything that waits for it ships: here nothing fits, so
    // there is no one-click fix, and the message says why.
    const fits = fittingReleases(moved, mapping, planOf(moved), moved.items.find(i => i.key === api.key)!).filter(r => r.title !== "Release 2");
    if (fits.length) expect(order?.fix?.label).toBe(`Move “${api.title}” to ${fits[0]!.title}`);
    else { expect(order?.fix).toBeUndefined(); expect(order?.message).toMatch(/No release fits it/); }
  });
});

describe("moving an epic", () => {
  const billing = epic("Billing and invoices");

  it("moves the epic and the open work that was with it", () => {
    const ops = moveEpicToRelease(project, mapping, billing, release("Release 4"));
    const keys = ops.filter(o => o.kind === "setMilestone").map(o => (o as Extract<Op, { kind: "setMilestone" }>).key);
    expect(keys).toContain(billing.key);
    const after = applyOps(project, ops).project;
    const moved = after.items.find(i => i.key === billing.key)!;
    expect(releaseOf(moved, mapping)?.title).toBe("Release 4");
    expect(epicRelease(after, mapping, moved)).toEqual({ title: "Release 4", own: true });
    // Closed work keeps the release it shipped in.
    for (const w of workOf(after, mapping, moved).filter(w => w.state !== "open")) {
      expect(w.milestone?.title).toBe(project.items.find(i => i.key === w.key)!.milestone?.title);
    }
  });

  it("leaves a story someone put in a different release where it is, unless told to bring it", () => {
    const before = epicRelease(project, mapping, billing)!.title;
    const stray = workOf(project, mapping, billing).find(w => w.state === "open" && w.milestone && w.milestone.title !== before);
    expect(stray).toBeTruthy();
    if (!stray) return;
    const ops = moveEpicToRelease(project, mapping, billing, release("Release 4"));
    expect(ops.some(o => "key" in o && o.key === stray.key)).toBe(false);
    const all = moveEpicToRelease(project, mapping, billing, release("Release 4"), { allStories: true });
    expect(all.some(o => "key" in o && o.key === stray.key)).toBe(true);
  });

  it("makes the release in a repository it is not in yet, once, before using it", () => {
    const only = { ...release("Release 3"), title: "Release 7", id: "Release 7", repos: ["demo-co/orbit"] };
    // Two of Offline mode's open stories live in the other repository.
    const offline = epic("Offline mode");
    const moveTwo = new Set(workOf(project, mapping, offline).filter(w => w.state === "open").slice(0, 2).map(w => w.key));
    const withSeven = {
      ...project,
      items: project.items.map(i => (moveTwo.has(i.key) ? { ...i, repo: "demo-co/orbit-api", milestone: null } : i)),
      milestones: [{ id: "M_7", title: "Release 7", number: 7, dueOn: null, state: "OPEN", repo: "demo-co/orbit" }],
    };
    const ops = moveEpicToRelease(withSeven, mapping, withSeven.items.find(i => i.key === offline.key)!, only);
    const makes = ops.filter(o => o.kind === "milestone");
    expect(makes).toHaveLength(1);
    expect(makes[0]).toMatchObject({ repo: "demo-co/orbit-api", before: null, after: { title: "Release 7" } });
    const firstUse = ops.findIndex(o => o.kind === "setMilestone" && (o as { after: { repo: string } | null }).after?.repo === "demo-co/orbit-api");
    expect(firstUse).toBeGreaterThan(ops.indexOf(makes[0]!));
    expect(ops.filter(o => o.kind === "setMilestone")).toHaveLength(1 + moveTwo.size + (workOf(project, mapping, offline).filter(w => w.state === "open").length - moveTwo.size));
  });

  it("takes an epic out of every release", () => {
    const after = applyOps(project, moveEpicToRelease(project, mapping, billing, null)).project;
    expect(releaseOf(after.items.find(i => i.key === billing.key)!, mapping)).toBeNull();
  });
});

describe("making a release and changing its date", () => {
  it("makes it in each repository named, and it shows straight away, empty", () => {
    const ops = createRelease(project, mapping, "Release 5", "2027-02-01", ["demo-co/orbit", "demo-co/orbit-api"]);
    expect(ops).toHaveLength(2);
    expect(describeOp(ops[0]!, k => k)).toMatch(/New release “Release 5” in demo-co\/orbit/);
    const after = applyOps(project, ops).project;
    expect(release("Release 5", after)).toMatchObject({ due: "2027-02-01", repos: ["demo-co/orbit", "demo-co/orbit-api"] });
  });

  it("does not make a release that is already there", () => {
    expect(createRelease(project, mapping, "Release 3", "2027-02-01", release("Release 3").repos)).toEqual([]);
    expect(createRelease(project, { ...mapping, release: { kind: "iteration", field: "Sprint" } }, "X", null, ["demo-co/orbit"])).toEqual([]);
  });

  it("moves the date in every repository, and on everything in the release", () => {
    const r = release("Release 3");
    const ops = setReleaseDue(project, mapping, r, "2027-01-15");
    expect(ops).toHaveLength(r.repos.length);
    const after = applyOps(project, ops).project;
    expect(release("Release 3", after).due).toBe("2027-01-15");
    expect(after.items.filter(i => i.milestone?.title === "Release 3").every(i => i.milestone!.dueOn === "2027-01-15")).toBe(true);
  });

  it("folds a new release and its later edits into one, and undoes it by closing it", () => {
    const made = createRelease(project, mapping, "Release 5", "2027-02-01", ["demo-co/orbit"]);
    const after = applyOps(project, made).project;
    const redated = setReleaseDue(after, mapping, release("Release 5", after), "2027-03-01");
    const net = netOps([...made, ...redated]);
    expect(net).toHaveLength(1);
    expect(net[0]).toMatchObject({ kind: "milestone", before: null, after: { dueOn: "2027-03-01" } });
    expect(inverseOps(made)[0]).toMatchObject({ kind: "milestone", before: { title: "Release 5" }, after: null });
    // Made and then closed in the same draft: nothing to do on GitHub.
    expect(netOps([...made, ...inverseOps(made)])).toEqual([]);
  });
});

describe("the releases an epic fits in", () => {
  it("are due after it finishes, and no earlier than what it waits for", () => {
    const plan = planOf();
    for (const e of project.items.filter(i => plan.epics.has(i.key))) {
      const end = plan.epics.get(e.key)!.end;
      const fits = fittingReleases(project, mapping, plan, e);
      for (const r of fits) {
        if (end && r.due) expect(r.due >= end).toBe(true);
        expect(r.closed).toBe(false);
      }
    }
    // The audit log waits for the API: it never fits a release before the API's.
    const audit = epic("Audit log and exports"), api = epic("Public REST API v2");
    const apiAt = listReleases(project, mapping).findIndex(r => r.title === epicRelease(project, mapping, api)!.title);
    const titles = listReleases(project, mapping).map(r => r.title);
    for (const r of fittingReleases(project, mapping, plan, audit)) expect(titles.indexOf(r.title)).toBeGreaterThanOrEqual(apiAt);
  });

  it("decide the fix for an epic that is late: the first that fits, or a new release when none does", () => {
    const b = releaseBoard(project, mapping, buildSchedule(project, mapping), planOf(), TODAY);
    for (const p of b.problems.filter(x => x.kind === "late")) {
      const e = project.items.find(i => i.key === p.keys[0])!;
      const fit = fittingReleases(project, mapping, planOf(), e).find(r => r.title !== epicRelease(project, mapping, e)!.title);
      if (fit) expect(p.fix?.label).toBe(`Move it to ${fit.title}`);
      else expect(p.message).toMatch(/No release is due late enough/);
    }
  });
});

describe("a model's placements", () => {
  const plan = planOf();

  it("are kept only when they respect the dependencies and the dates", () => {
    const api = epic("Public REST API v2");
    const blocker = plan.links.find(l => l.to === api.key)!;
    expect(blocker).toBeTruthy();
    const { accepted, dropped } = checkPlacements(project, mapping, plan, [
      { key: api.key, release: "Release 2", why: "ship it sooner" },
      { key: "nope#1", release: "Release 3", why: "" },
      { key: api.key, release: "Release 99", why: "" },
      { key: epic("Offline mode").key, release: "Release 4", why: "" },
    ]);
    expect(dropped.map(d => d.reason)).toEqual(expect.arrayContaining([
      "that is not an epic in this project",
      "Release 99 is not an open release in this project",
    ]));
    expect(dropped.some(d => /ships later|finish after/.test(d.reason))).toBe(true);
    // Leaving an epic where it already is is not counted as a wrong answer.
    const here = checkPlacements(project, mapping, plan, [{ key: api.key, release: epicRelease(project, mapping, api)!.title, why: "" }]);
    expect(here).toEqual({ accepted: [], dropped: [] });
    expect(accepted.every(a => a.ops.length > 0)).toBe(true);
  });

  it("are asked for one epic at a time, with what each needs and what it waits for", () => {
    const prompt = promptPlacement({ releases: [{ title: "Release 2", due: "2026-10-30" }], today: TODAY, epics: [
      { key: "a#1", title: "A", release: null, finishes: "2026-11-01", waitsFor: ["b#2"], problem: "it is in no release", options: ["Release 3", "Release 4"] },
      { key: "b#2", title: "B", release: "Release 2", finishes: "2026-10-01", waitsFor: [], problem: null, options: [] },
    ] });
    expect(prompt).toContain("Release 2 — due 2026-10-30: B");
    expect(prompt).toContain("a#1 | A | in no release | finishes 2026-11-01 | waits for b#2\n    needs: it is in no release\n    options: Release 3, Release 4");
    // An epic that is fine is there for the order, not as a question.
    expect(prompt.indexOf("b#2 | B")).toBeGreaterThan(prompt.indexOf("fine where they are"));
    expect(checkPlacementAnswer({ placements: [{ key: "a", release: "R", why: "x" }] })).toBe(true);
    expect(checkPlacementAnswer({ placements: [{ key: 1 }] })).toBe(false);
  });
});

describe("writing releases to GitHub", () => {
  /** A fake GitHub: GraphQL for the issues, REST for the milestones. */
  function fake() {
    const rest: { method: string; path: string; body: unknown }[] = [];
    const graphql: { name: string; vars: Record<string, unknown> }[] = [];
    const milestones = [{ number: 3, node_id: "M_3", title: "Release 3", state: "open", due_on: "2026-11-27T12:00:00Z" }];
    const fetchImpl: FetchLike = async (url, init) => {
      const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "x-oauth-scopes": "project, repo" } });
      if (url.includes("/milestones")) {
        const method = init.method ?? "GET";
        const body = init.body ? JSON.parse(String(init.body)) : null;
        if (method === "GET") return ok(milestones);
        rest.push({ method, path: url.replace("https://api.github.com", ""), body });
        if (method === "POST") { const m = { number: 10, node_id: "M_new", title: body.title, state: "open", due_on: body.due_on }; milestones.push(m); return ok(m, 201); }
        return ok({ ...milestones[0], ...body });
      }
      const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
      graphql.push({ name: query.match(/(?:query|mutation) (\w+)/)?.[1] ?? "?", vars: variables });
      return ok({ data: { ok: true } });
    };
    return { client: createClient("t", fetchImpl), rest, graphql };
  }
  const repos = () => new Map<string, RepoMeta>([["demo-co/orbit", { id: "R_orbit", labels: {}, milestones: { "Release 3": "M_3" }, users: {} }]]);
  const titleOf = (k: string) => k;
  const story = project.items.find(i => i.repo === "demo-co/orbit" && i.state === "open" && i.kind === "issue" && i.milestone?.title !== "Release 5")!;

  it("makes a release first, then puts work in it, in one apply", async () => {
    const made = createRelease(project, mapping, "Release 5", "2027-02-01", ["demo-co/orbit"]);
    const after = applyOps(project, made).project;
    const put = moveEpicToRelease(after, mapping, story, release("Release 5", after));
    const g = fake();
    const res = await execute(g.client, project, buildSteps(netOps([...made, ...put]), titleOf), new Map(), repos());
    expect(res.steps.every(s => s.status === "applied")).toBe(true);
    expect(g.rest).toEqual([{ method: "POST", path: "/repos/demo-co/orbit/milestones", body: { title: "Release 5", due_on: "2027-02-01T12:00:00Z" } }]);
    expect(g.graphql.find(c => c.name === "UpdateIssue")?.vars).toMatchObject({ milestoneId: "M_new" });
  });

  it("changes a release's date by its number, and closes rather than deletes", async () => {
    const r = release("Release 3");
    const ops = setReleaseDue(project, mapping, { ...r, repos: ["demo-co/orbit"] }, "2027-01-15");
    const g = fake();
    await execute(g.client, project, buildSteps(ops, titleOf), new Map(), repos());
    expect(g.rest[0]).toMatchObject({ method: "PATCH", path: "/repos/demo-co/orbit/milestones/3", body: { due_on: "2027-01-15T12:00:00Z" } });
    const g2 = fake();
    await execute(g2.client, project, buildSteps([{ kind: "milestone", ref: "demo-co/orbit#Release 3", repo: "demo-co/orbit", before: { title: "Release 3", dueOn: null, state: "open" }, after: null }], titleOf), new Map(), repos());
    expect(g2.rest[0]).toMatchObject({ method: "PATCH", body: { state: "closed" } });
  });

  it("refuses a repository name that is not a plain owner/name, or not one of the project's", async () => {
    // A rollback can carry ops from the shared history, which other people write.
    for (const repo of ["../../user", "demo-co/orbit/../../x", "demo-co/..", "demo-co/orbit?x=1", "someone/else"]) {
      const g = fake();
      const res = await execute(g.client, project, buildSteps([{ kind: "milestone", ref: `${repo}#R`, repo, before: null, after: { title: "R", dueOn: null, state: "open" } }], titleOf), new Map(), repos());
      expect(res.steps[0]!.status).toBe("failed");
      expect(g.rest).toEqual([]);
    }
  });

  it("uses a release that is already on GitHub instead of making it twice, and writes nothing in a dry run", async () => {
    const g = fake();
    const res = await execute(g.client, project, buildSteps([{ kind: "milestone", ref: "demo-co/orbit#Release 3", repo: "demo-co/orbit", before: null, after: { title: "Release 3", dueOn: null, state: "open" } }], titleOf), new Map(), repos());
    expect(g.rest).toEqual([]);
    expect(res.steps[0]!.message).toMatch(/Already/);
    const dry = fake();
    const r2 = await execute(dry.client, project, buildSteps(createRelease(project, mapping, "Release 6", null, ["demo-co/orbit"]), titleOf), new Map(), repos(), { dryRun: true });
    expect(dry.rest).toEqual([]);
    expect(r2.calls.map(c => c.name)).toEqual(["POST /repos/demo-co/orbit/milestones"]);
  });
});
