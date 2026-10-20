// The plan engine: when each epic could really start, which chain decides the end, what
// is wrong with the plan, and what survives the checks when a model proposes links.
import { describe, expect, it, afterEach, vi } from "vitest";
import { normalizeProject, type Project } from "../src/model/normalize";
import { detectMapping, type Mapping } from "../src/model/mapping";
import { buildPlan, wouldLoop } from "../src/model/plan/cpm";
import { checkLinks, checkReleases, evidenceFound } from "../src/model/plan/infer";
import { buildSchedule } from "../src/model/schedule";
import { chatJson, checkLinks as checkLinkAnswer, promptDependencies, SYSTEM_DEPENDENCIES } from "../src/ai/local";
import { candidatePairs } from "../src/views/usePlanSuggestions";

interface Itemish {
  title: string; parent?: string; start?: string; end?: string; release?: string;
  /** A repository milestone, for projects that use milestones as releases. */
  milestone?: { title: string; due: string };
  /** Titles of the items that block this one. */
  blockedBy?: string[]; epic?: boolean; body?: string;
}

/** A project with dates, releases and blocked-by links. */
function make(items: Itemish[], rule: "field" | "milestone" = "field"): { project: Project; mapping: Mapping } {
  const meta = {
    id: "PVT_plan", number: 3, title: "Plan test", url: "https://example.com", shortDescription: null, closed: false,
    updatedAt: "2026-01-01T00:00:00Z", items: { totalCount: items.length },
    fields: { nodes: [
      { __typename: "ProjectV2Field", id: "f-title", name: "Title", dataType: "TITLE" },
      { __typename: "ProjectV2Field", id: "f-start", name: "Start date", dataType: "DATE" },
      { __typename: "ProjectV2Field", id: "f-end", name: "Target date", dataType: "DATE" },
      { __typename: "ProjectV2SingleSelectField", id: "f-rel", name: "Release", dataType: "SINGLE_SELECT", options: [
        { id: "r1", name: "Release 1", color: "fff" }, { id: "r2", name: "Release 2", color: "fff" }] },
    ] },
  };
  const numberOf = new Map(items.map((it, n) => [it.title, n + 1]));
  const idOf = new Map(items.map((it, n) => [it.title, `I_${n}`]));
  const raws = items.map((it, n) => {
    const fv: unknown[] = [];
    if (it.start) fv.push({ __typename: "ProjectV2ItemFieldDateValue", date: it.start, field: { id: "f-start", name: "Start date" } });
    if (it.end) fv.push({ __typename: "ProjectV2ItemFieldDateValue", date: it.end, field: { id: "f-end", name: "Target date" } });
    if (it.release) fv.push({ __typename: "ProjectV2ItemFieldSingleSelectValue", name: it.release, optionId: "r1", field: { id: "f-rel", name: "Release" } });
    return {
      id: `item-${n}`, type: "ISSUE", isArchived: false, fieldValues: { nodes: fv },
      content: {
        __typename: "Issue", id: `I_${n}`, number: n + 1, title: it.title, body: it.body ?? "", url: "https://example.com/1",
        state: "OPEN", stateReason: null, createdAt: "2026-01-01T00:00:00Z", closedAt: null, updatedAt: "2026-01-01T00:00:00Z",
        repository: { nameWithOwner: "o/r" },
        labels: { nodes: it.epic ? [{ id: "L_e", name: "type: epic", color: "fff" }] : [] },
        assignees: { nodes: [] },
        milestone: it.milestone ? { id: "M_1", title: it.milestone.title, number: 1, dueOn: `${it.milestone.due}T00:00:00Z`, state: "OPEN", repo: "o/r" } : null,
        issueType: null,
        parent: it.parent ? { id: idOf.get(it.parent), number: numberOf.get(it.parent), repository: { nameWithOwner: "o/r" } } : null,
        subIssuesSummary: { total: 0, completed: 0 },
        blockedBy: { nodes: (it.blockedBy ?? []).map(t => ({ id: idOf.get(t), number: numberOf.get(t), state: "OPEN", repository: { nameWithOwner: "o/r" } })) },
      },
    };
  });
  const project = normalizeProject("o", meta as never, raws as never, "2026-01-01T00:00:00Z");
  const mapping = detectMapping(project);
  return { project, mapping: { ...mapping, release: rule === "field" ? { kind: "field", field: "Release" } : { kind: "milestone" } } };
}

/** An epic with one story, and a release. */
function epic(title: string, start: string, end: string, release?: string, body?: string): Itemish[] {
  return [
    { title: `${title} epic`, start, end, release, epic: true, body: body ?? `${title} epic` },
    { title: `${title} story`, parent: `${title} epic`, body: body ?? `${title} story` },
  ];
}

const planOf = (p: Project, m: Mapping) => buildPlan(p, m, buildSchedule(p, m));

describe("the plan engine", () => {
  it("finds the chain that decides when the plan ends", () => {
    const { project, mapping } = make([
      ...epic("A", "2026-01-01", "2026-01-10"),
      ...epic("B", "2026-01-11", "2026-01-20"),
      ...epic("C", "2026-01-21", "2026-01-30", "Release 1"),
    ]);
    // B waits for A, C waits for B.
    project.items.find(i => i.title === "B story")!.blockedBy = [{ key: project.items.find(i => i.title === "A story")!.key, open: true }];
    project.items.find(i => i.title === "C story")!.blockedBy = [{ key: project.items.find(i => i.title === "B story")!.key, open: true }];
    const plan = planOf(project, mapping);
    expect(plan.links.length).toBe(2);
    expect(plan.critical.length).toBe(3);
    expect(plan.endsOn).toBe("2026-01-30");
    expect(plan.problems.filter(p => p.severity === 3)).toHaveLength(0);
  });

  it("says when an epic starts before the thing that blocks it is finished", () => {
    const { project, mapping } = make([
      ...epic("A", "2026-01-01", "2026-01-10"),
      ...epic("B", "2026-01-05", "2026-01-20"),
    ]);
    project.items.find(i => i.title === "B story")!.blockedBy = [{ key: project.items.find(i => i.title === "A story")!.key, open: true }];
    const plan = planOf(project, mapping);
    const problem = plan.problems.find(p => p.kind === "early");
    expect(problem).toBeDefined();
    expect(problem!.message).toContain("5 days before");
    expect(problem!.remedy).toContain("2026-01-10");
  });

  it("says when the work finishes after the release is due", () => {
    const { project, mapping } = make([
      ...epic("A", "2026-01-01", "2026-01-10"),
      ...epic("B", "2026-01-11", "2026-01-20"),
    ].map(it => it.title.endsWith("epic") ? { ...it, milestone: { title: "Release 1", due: "2026-01-15" } } : it), "milestone");
    project.items.find(i => i.title === "B story")!.blockedBy = [{ key: project.items.find(i => i.title === "A story")!.key, open: true }];
    const plan = planOf(project, mapping);
    const late = plan.problems.find(p => p.kind === "late");
    expect(late).toBeDefined();
    expect(late!.message).toContain("5 days after");
  });

  it("finds a loop between epics", () => {
    const { project, mapping } = make([...epic("A", "2026-01-01", "2026-01-10"), ...epic("B", "2026-01-01", "2026-01-10")]);
    project.items.find(i => i.title === "A story")!.blockedBy = [{ key: project.items.find(i => i.title === "B story")!.key, open: true }];
    project.items.find(i => i.title === "B story")!.blockedBy = [{ key: project.items.find(i => i.title === "A story")!.key, open: true }];
    const plan = planOf(project, mapping);
    const loop = plan.problems.find(p => p.kind === "cycle");
    expect(loop).toBeDefined();
    expect(loop!.keys.length).toBe(2);
    expect(loop!.severity).toBe(3);
  });

  it("notices an epic with no dates and one with no release", () => {
    const { project, mapping } = make([
      ...epic("A", "2026-01-01", "2026-01-10"),
      { title: "D epic", epic: true },
      { title: "D story", parent: "D epic" },
    ]);
    const plan = planOf(project, mapping);
    expect(plan.problems.some(p => p.kind === "undated")).toBe(true);
    expect(plan.problems.some(p => p.kind === "norelease")).toBe(true);
  });

  it("knows when a link would close a loop", () => {
    const links = [{ from: "a", to: "b" }, { from: "b", to: "c" }];
    expect(wouldLoop(links, "c", "a")).toBe(true);
    expect(wouldLoop(links, "a", "c")).toBe(false);
  });
});

describe("checking what a model says", () => {
  const setup = () => {
    const { project, mapping } = make([
      { title: "API epic", start: "2026-01-01", end: "2026-01-10", epic: true, body: "Build the API" },
      { title: "API story", parent: "API epic", body: "Build the API endpoints" },
      { title: "App epic", start: "2026-01-11", end: "2026-01-20", epic: true, body: "The app needs the API first", release: "Release 1" },
      { title: "App story", parent: "App epic", body: "The app needs the API first" },
    ]);
    return { project, mapping, plan: planOf(project, mapping) };
  };

  it("keeps a link whose reason can be found in the items", () => {
    const { project, mapping, plan } = setup();
    const api = project.items.find(i => i.title === "API story")!.key;
    const app = project.items.find(i => i.title === "App story")!.key;
    const out = checkLinks(project, mapping, plan, [{ from: api, to: app, evidence: "needs the API first" }]);
    expect(out.accepted).toHaveLength(1);
    expect(out.accepted[0]!.ops[0]).toMatchObject({ kind: "addBlockedBy", key: app, blocker: api });
    expect(out.accepted[0]!.evidenceIn).toBe("App story");
  });

  it("drops a link whose reason is not in the items", () => {
    const { project, mapping, plan } = setup();
    const api = project.items.find(i => i.title === "API story")!.key;
    const app = project.items.find(i => i.title === "App story")!.key;
    const out = checkLinks(project, mapping, plan, [{ from: api, to: app, evidence: "the database is ready" }]);
    expect(out.accepted).toHaveLength(0);
    expect(out.dropped[0]!.reason).toContain("could not be found");
  });

  it("drops a link to something that is not in the project", () => {
    const { project, mapping, plan } = setup();
    const api = project.items.find(i => i.title === "API story")!.key;
    const out = checkLinks(project, mapping, plan, [{ from: api, to: "o/r#999", evidence: "needs the API first" }]);
    expect(out.accepted).toHaveLength(0);
    expect(out.dropped[0]!.reason).toContain("not in this project");
  });

  it("drops a link that would close a loop", () => {
    const { project, mapping, plan } = setup();
    const api = project.items.find(i => i.title === "API story")!.key;
    const app = project.items.find(i => i.title === "App story")!.key;
    project.items.find(i => i.title === "API story")!.blockedBy = [{ key: app, open: true }];
    const out = checkLinks(project, mapping, plan, [{ from: api, to: app, evidence: "needs the API first" }]);
    expect(out.accepted).toHaveLength(0);
    expect(out.dropped[0]!.reason).toContain("loop");
  });

  it("drops a link that is already there", () => {
    const { project, mapping, plan } = setup();
    const api = project.items.find(i => i.title === "API story")!.key;
    const app = project.items.find(i => i.title === "App story")!.key;
    project.items.find(i => i.title === "App story")!.blockedBy = [{ key: api, open: true }];
    const out = checkLinks(project, mapping, plan, [{ from: api, to: app, evidence: "needs the API first" }]);
    expect(out.accepted).toHaveLength(0);
    expect(out.dropped[0]!.reason).toContain("already there");
  });

  it("keeps a release that exists and drops one that does not", () => {
    const { project, mapping } = setup();
    const api = project.items.find(i => i.title === "API epic")!.key;
    const out = checkReleases(project, mapping, [
      { release: "Release 1", epics: [api], why: "they go together" },
      { release: "Release 9", epics: [api], why: "does not exist" },
    ]);
    expect(out.accepted).toHaveLength(1);
    expect(out.accepted[0]!.release).toBe("Release 1");
    expect(out.accepted[0]!.ops[0]).toMatchObject({ kind: "setField", field: "Release" });
    expect(out.dropped[0]!.reason).toContain("not a release");
  });

  it("checks a quote against the item, not the model's memory", () => {
    const item = { title: "Build the API", body: "The app needs the API first" } as never;
    expect(evidenceFound("needs the API first", item)).toBe(true);
    expect(evidenceFound("NEEDS the api FIRST", item)).toBe(true);
    expect(evidenceFound("needs the database", item)).toBe(false);
    expect(evidenceFound("no", item)).toBe(false);
  });
});

describe("asking the model about the plan", () => {
  const settings = { enabled: true, base: "http://localhost:11434/v1", chatModel: "qwen3", embedModel: "qwen3-embedding" };

  /** A stand-in for fetch that answers with the given content. */
  function stub(content: string | null) {
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (content === null) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
    }));
  }
  afterEach(() => vi.unstubAllGlobals());

  const setup = () => {
    const { project, mapping } = make([
      { title: "API epic", start: "2026-01-01", end: "2026-01-10", epic: true, body: "Build the API" },
      { title: "API story", parent: "API epic", body: "Build the API endpoints" },
      { title: "App epic", start: "2026-01-11", end: "2026-01-20", epic: true, body: "The app needs the API first" },
      { title: "App story", parent: "App epic", body: "The app needs the API first" },
    ]);
    return { project, mapping, plan: planOf(project, mapping) };
  };

  it("shortlists the pairs worth asking about", () => {
    const { project, mapping } = setup();
    const pairs = candidatePairs(project, mapping);
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(p.a).not.toBe(p.b);
      expect(p.aTitle.length).toBeGreaterThan(0);
    }
  });

  it("keeps a model answer only when it holds up", async () => {
    const { project, mapping, plan } = setup();
    const api = project.items.find(i => i.title === "API story")!.key;
    const app = project.items.find(i => i.title === "App story")!.key;
    stub(JSON.stringify({ links: [{ from: api, to: app, evidence: "needs the API first" }] }));
    const answer = await chatJson(settings, SYSTEM_DEPENDENCIES, promptDependencies([]), checkLinkAnswer);
    expect(answer).not.toBeNull();
    const checked = checkLinks(project, mapping, plan, answer!.links);
    expect(checked.accepted).toHaveLength(1);
    expect(checked.accepted[0]!.ops[0]).toMatchObject({ kind: "addBlockedBy" });
  });

  it("drops a model answer that is not the right shape", async () => {
    stub(JSON.stringify({ links: [{ from: "a", to: "b" }] }));
    expect(await chatJson(settings, SYSTEM_DEPENDENCIES, "p", checkLinkAnswer)).toBeNull();
    stub("not json at all");
    expect(await chatJson(settings, SYSTEM_DEPENDENCIES, "p", checkLinkAnswer)).toBeNull();
  });

  it("drops a model answer whose reason is made up", async () => {
    const { project, mapping, plan } = setup();
    const api = project.items.find(i => i.title === "API story")!.key;
    const app = project.items.find(i => i.title === "App story")!.key;
    stub(JSON.stringify({ links: [{ from: api, to: app, evidence: "the database is migrated" }] }));
    const answer = await chatJson(settings, SYSTEM_DEPENDENCIES, "p", checkLinkAnswer);
    const checked = checkLinks(project, mapping, plan, answer!.links);
    expect(checked.accepted).toHaveLength(0);
    expect(checked.dropped[0]!.reason).toContain("could not be found");
  });

  it("copes with the model not being there", async () => {
    stub(null);
    expect(await chatJson(settings, SYSTEM_DEPENDENCIES, "p", checkLinkAnswer)).toBeNull();
  });
});
