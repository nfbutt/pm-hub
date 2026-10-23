// The epics as a graph: the links between them, where they overlap, the links the issues
// themselves state, and the gate every model proposal passes.
import { describe, expect, it } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { analyze } from "../src/model/epicmap";
import { canLink, checkEpicLinks, epicGraph, layers, linkEpics, textHints, unlinkEpics } from "../src/model/epiclinks";
import { detectMapping } from "../src/model/mapping";
import { normalizeProject, type Project } from "../src/model/normalize";
import { applyOps, inverseOps } from "../src/model/ops";
import { buildPlan } from "../src/model/plan/cpm";
import { evidenceFound } from "../src/model/plan/infer";
import { buildSchedule } from "../src/model/schedule";
import { briefOf, checkEpicLinkAnswer, promptEpicLinks } from "../src/ai/epics";

const TODAY = "2026-10-19";
const f = makeFixture(TODAY);
const project = normalizeProject(DEMO_OWNER, f.meta, f.items, TODAY + "T12:00:00Z");
const mapping = detectMapping(project);
const epic = (title: string, p = project) => p.items.find(i => i.title === title)!;
const graphOf = (p: Project = project) => {
  const plan = buildPlan(p, mapping, buildSchedule(p, mapping));
  return { plan, graph: epicGraph(p, mapping, plan, analyze(p, mapping, { openOnly: true })) };
};

describe("the graph", () => {
  const { plan, graph } = graphOf();

  it("has every open epic, and only open epics", () => {
    const keys = graph.nodes.map(n => n.key);
    expect(keys).toContain(epic("Offline mode").key);
    expect(keys).not.toContain(epic("Customer onboarding flow").key);
    for (const n of graph.nodes) expect(n.done).toBeLessThanOrEqual(n.total);
  });

  it("tells a link made between the epics from one that comes through their stories", () => {
    const direct = graph.edges.find(e => e.from === epic("Public REST API v2").key && e.to === epic("Audit log and exports").key);
    expect(direct?.kind).toBe("direct");
    for (const e of graph.edges.filter(x => x.kind === "stories")) expect(e.via.length).toBeGreaterThan(0);
    // The plan engine sees the same links.
    for (const e of graph.edges) expect(plan.links.some(l => l.from === e.from && l.to === e.to)).toBe(true);
  });

  it("carries the overlaps between open epics, strongest first", () => {
    expect(graph.overlaps.length).toBeGreaterThan(0);
    const scores = graph.overlaps.map(o => o.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("lays out each epic after everything it waits for", () => {
    const cols = layers(graph);
    const col = new Map(cols.flatMap((c, i) => c.map(k => [k, i] as const)));
    for (const e of graph.edges) expect(col.get(e.from)!).toBeLessThan(col.get(e.to)!);
    expect(cols.flat().sort()).toEqual(graph.nodes.map(n => n.key).sort());
  });
});

describe("drawing a link", () => {
  const { plan } = graphOf();
  const billing = epic("Billing and invoices"), pricing = epic("Usage-based pricing engine");

  it("is a blocked-by on the epic that waits, and can be taken away again", () => {
    const ops = linkEpics(project, plan, pricing, billing);
    expect(ops).toEqual([{ kind: "addBlockedBy", key: billing.key, blocker: pricing.key }]);
    const after = applyOps(project, ops).project;
    const g = graphOf(after).graph;
    expect(g.edges.find(e => e.from === pricing.key && e.to === billing.key)?.kind).toBe("direct");
    const back = applyOps(after, unlinkEpics(epic("Usage-based pricing engine", after), epic("Billing and invoices", after))).project;
    expect(graphOf(back).graph.edges.some(e => e.from === pricing.key && e.to === billing.key)).toBe(false);
    expect(inverseOps(ops)[0]).toMatchObject({ kind: "removeBlockedBy" });
  });

  it("refuses an epic waiting for itself, a link that is there, and a loop", () => {
    const api = epic("Public REST API v2"), audit = epic("Audit log and exports");
    expect(canLink(project, plan, api.key, api.key)).toMatchObject({ ok: false });
    expect(canLink(project, plan, api.key, audit.key).why).toMatch(/already/);
    expect(canLink(project, plan, audit.key, api.key).why).toMatch(/wait for each other/);
    expect(linkEpics(project, plan, audit, api)).toEqual([]);
  });
});

describe("links the issues state", () => {
  const { plan, graph } = graphOf();
  const hints = textHints(project, mapping, plan, graph);
  const pair = (from: string, to: string) => hints.find(h => h.from === epic(from).key && h.to === epic(to).key);

  it("are found by the title, the words that name an epic, or a number", () => {
    expect(pair("Usage-based pricing engine", "Billing and invoices")?.evidence).toBe("Overage charges depend on the usage-based pricing engine.");
    expect(pair("Public REST API v2", "Mobile notifications")).toBeTruthy();
    expect(pair("Mobile notifications", "Offline mode")).toBeTruthy();
  });

  it("quote words that really are in the issue, and are ready to record", () => {
    for (const h of hints) {
      const source = project.items.find(i => i.title === h.evidenceIn)!;
      expect(evidenceFound(h.evidence, source)).toBe(true);
      expect(h.ops).toEqual([{ kind: "addBlockedBy", key: h.to, blocker: h.from }]);
    }
  });

  it("leave out a link that is there already, or that would close a loop", () => {
    const linked = applyOps(project, pair("Usage-based pricing engine", "Billing and invoices")!.ops).project;
    const g = graphOf(linked);
    const again = textHints(linked, mapping, g.plan, g.graph);
    expect(again.some(h => h.from === epic("Usage-based pricing engine").key && h.to === epic("Billing and invoices").key)).toBe(false);
  });

  it("are not found in text with no word of dependency in it", () => {
    for (const h of hints) expect(h.evidence).toMatch(/depend|need|once|after|require|wait|block|until|build|top of|rel(y|ies)|uses the|prerequisite/i);
  });
});

describe("what a model proposes", () => {
  const { plan, graph } = graphOf();
  const billing = epic("Billing and invoices"), pricing = epic("Usage-based pricing engine");
  const api = epic("Public REST API v2"), audit = epic("Audit log and exports");

  it("is kept when the quote is in either epic or one of their stories", () => {
    const { accepted } = checkEpicLinks(project, mapping, plan, graph, [
      { from: pricing.key, to: billing.key, evidence: "overage charges depend on the usage-based pricing engine" },
    ]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ source: "model", evidenceIn: "Billing and invoices" });
  });

  it("is kept when a story is quoted as \"title — sentence\", the way the model was shown it", () => {
    const story = project.items.find(i => i.parentKey === billing.key && i.state === "open" && i.body)!;
    const withNeed = { ...project, items: project.items.map(i => (i.key === story.key ? { ...i, body: "Runs after the usage-based pricing engine is live. More text." } : i)) };
    const g = graphOf(withNeed);
    const { accepted } = checkEpicLinks(withNeed, mapping, g.plan, g.graph, [
      { from: pricing.key, to: billing.key, evidence: `${story.title} — Runs after the usage-based pricing engine is live.` },
    ]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.evidenceIn).toBe(story.title);
  });

  it("is dropped when the quote is real but says nothing about one waiting for the other", () => {
    const story = project.items.find(i => i.parentKey === billing.key && i.state === "open" && i.body)!;
    const sentence = story.body!.split(/(?<=[.!?])\s/)[0]!;
    const { accepted, dropped } = checkEpicLinks(project, mapping, plan, graph, [{ from: pricing.key, to: billing.key, evidence: sentence }]);
    expect(accepted).toEqual([]);
    expect(dropped[0]!.reason).toBe("the quote does not say that one waits for the other");
  });

  it("is dropped when it is made up, already there, a loop, or not about epics", () => {
    const { accepted, dropped } = checkEpicLinks(project, mapping, plan, graph, [
      { from: pricing.key, to: billing.key, evidence: "the board asked for it" },
      { from: api.key, to: audit.key, evidence: "anything" },
      { from: audit.key, to: api.key, evidence: "anything" },
      { from: "nope#1", to: billing.key, evidence: "x" },
      { from: billing.key, to: billing.key, evidence: "x" },
    ]);
    expect(accepted).toEqual([]);
    expect(dropped.map(d => d.reason)).toEqual([
      "the reason could not be found in either epic or their stories",
      "that link is already there",
      "it would make the epics wait for each other",
      "one of them is not an open epic here",
      "an epic cannot wait for itself",
    ]);
  });

  it("is asked for with each epic, what it is about, its stories, and the links already there", () => {
    const brief = briefOf({ key: "a#1", title: "A", body: "Needs the API. ".repeat(40) }, [{ title: "Story", body: "Runs after the import. More." }]);
    expect(brief.summary.length).toBeLessThanOrEqual(280);
    expect(brief.stories).toEqual(["Story — Runs after the import."]);
    const prompt = promptEpicLinks([brief], [{ from: "b#2", to: "a#1" }]);
    expect(prompt).toMatch(/a#1 \| A/);
    expect(prompt).toMatch(/b#2 -> a#1/);
    expect(checkEpicLinkAnswer({ links: [{ from: "a", to: "b", evidence: "c" }] })).toBe(true);
    expect(checkEpicLinkAnswer({ links: [{ from: "a" }] })).toBe(false);
    expect(checkEpicLinkAnswer({ nope: [] })).toBe(false);
  });
});
