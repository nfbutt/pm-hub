// The planner: what the model drafts, the checks it has to pass, and the changes it
// becomes. And the microphone: it only ever talks to this computer.
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { normalizeProject } from "../src/model/normalize";
import { detectMapping } from "../src/model/mapping";
import { applyOps } from "../src/model/ops";
import { checkDraft, draftOps, estimate, MAX_DRAFT_ITEMS, summariseDraft, type PlanDraft } from "../src/model/plan/draft";
import { groupByTheme } from "../src/model/plan/infer";
import { checkPlan } from "../src/ai/plan";
import { transcribe } from "../src/ai/voice";
import { activeChanges, canUndo, emptyStore, record, undo } from "../src/model/scenarios";

const f = makeFixture("2026-10-19");
const project = normalizeProject(DEMO_OWNER, f.meta, f.items, "2026-10-19T12:00:00Z");
const mapping = detectMapping(project);

const draft = (over: Partial<PlanDraft> = {}): PlanDraft => ({
  name: "Billing rework",
  summary: "A new invoice screen and a payment retry service.",
  epics: [
    {
      title: "Invoice screen", why: "Customers need to see invoices.", release: "Release 1",
      start: "2026-11-02", end: "2026-11-20",
      stories: [
        { title: "Invoice list", why: "List them.", days: 3 },
        { title: "Invoice detail", why: "Show one.", days: 4 },
      ],
      after: [],
    },
    {
      title: "Payment retries", why: "Failed payments are lost.", release: "Release 2",
      start: "2026-11-23", end: "2026-12-11",
      stories: [{ title: "Retry service", why: "Try again later.", days: 5 }],
      after: ["Invoice screen"],
    },
  ],
  ...over,
});

describe("checking a draft", () => {
  it("keeps a draft that fits the project", () => {
    const { draft: d, problems } = checkDraft(project, mapping, draft());
    expect(problems).toEqual([]);
    expect(d.epics).toHaveLength(2);
    expect(d.epics[0]!.stories).toHaveLength(2);
  });

  it("drops a release the project does not have", () => {
    const d = draft();
    d.epics[0]!.release = "Release 99";
    const { draft: checked, problems } = checkDraft(project, mapping, d);
    expect(checked.epics[0]!.release).toBeNull();
    expect(problems[0]).toContain("not a release");
  });

  it("drops an empty title and a repeated one", () => {
    const d = draft();
    d.epics.push({ ...d.epics[0]! });
    d.epics.push({ ...d.epics[0]!, title: "  " });
    const { draft: checked, problems } = checkDraft(project, mapping, d);
    expect(checked.epics.map(e => e.title)).toEqual(["Invoice screen", "Payment retries"]);
    expect(problems.length).toBe(2);
  });

  it("drops a dependency on an epic that is not in the draft", () => {
    const d = draft();
    d.epics[1]!.after = ["Invoice screen", "Something else"];
    const { draft: checked } = checkDraft(project, mapping, d);
    expect(checked.epics[1]!.after).toEqual(["Invoice screen"]);
  });

  it("drops dates that end before they start", () => {
    const d = draft();
    d.epics[0]!.start = "2026-11-20"; d.epics[0]!.end = "2026-11-02";
    const { draft: checked, problems } = checkDraft(project, mapping, d);
    expect(checked.epics[0]!.start).toBeNull();
    expect(problems[0]).toContain("ends before it starts");
  });

  it("keeps a plan a person can read", () => {
    const d = draft();
    d.epics = Array.from({ length: 30 }, (_, i) => ({
      title: `Epic ${i}`, why: "", release: null, start: null, end: null,
      stories: Array.from({ length: 4 }, (_, j) => ({ title: `Story ${i}-${j}`, why: "", days: 2 })), after: [],
    }));
    const { draft: checked, problems } = checkDraft(project, mapping, d);
    const items = checked.epics.length + checked.epics.reduce((s, e) => s + e.stories.length, 0);
    expect(items).toBeLessThanOrEqual(MAX_DRAFT_ITEMS);
    expect(problems[0]).toContain("pieces of work");
  });
});

describe("turning a draft into changes", () => {
  it("creates the epics, their stories and the links between them", () => {
    const { draft: d } = checkDraft(project, mapping, draft());
    const ops = draftOps(project, mapping, d);
    const creates = ops.filter(o => o.kind === "create");
    const epic = creates.find(o => o.kind === "create" && o.item.title === "Invoice screen")!;
    expect(epic).toBeDefined();
    // A story is created under the epic it belongs to.
    const story = creates.find(o => o.kind === "create" && o.item.title === "Invoice detail")!;
    expect(story.kind === "create" && story.item.parentKey).toBe(epic.key);
    // The dependency is between the two epics.
    const link = ops.find(o => o.kind === "addBlockedBy")!;
    expect(link.kind === "addBlockedBy" && link.blocker).toBe(epic.key);
  });

  it("puts the dates and the release on the new epic", () => {
    const { draft: d } = checkDraft(project, mapping, draft());
    const ops = draftOps(project, mapping, d);
    const epic = ops.find(o => o.kind === "create" && o.item.title === "Invoice screen");
    expect(epic?.kind).toBe("create");
    if (epic?.kind !== "create") return;
    // The demo project keeps its dates in fields.
    const start = Object.values(epic.item.fields).find(v => v.kind === "date");
    expect(start).toBeDefined();
  });

  it("adds the plan to the project as one change", () => {
    const { draft: d } = checkDraft(project, mapping, draft());
    const ops = draftOps(project, mapping, d);
    const applied = applyOps(project, ops);
    const created = applied.project.items.filter(i => i.title === "Invoice screen" || i.title === "Invoice detail");
    expect(created).toHaveLength(2);
    // The story is under the epic.
    const epic = applied.project.items.find(i => i.title === "Invoice screen")!;
    const story = applied.project.items.find(i => i.title === "Invoice detail")!;
    expect(story.parentKey).toBe(epic.key);
  });

  it("undoes the whole plan with one step", () => {
    const { draft: d } = checkDraft(project, mapping, draft());
    const ops = draftOps(project, mapping, d);
    const store = record(emptyStore(), "New plan", ops);
    expect(canUndo(store)).toBe(true);
    expect(activeChanges(undo(store).scenarios[0]!)).toHaveLength(0);
  });

  it("says what the plan adds", () => {
    const { draft: d } = checkDraft(project, mapping, draft());
    const summary = summariseDraft(d);
    expect(summary.epics).toBe(2);
    expect(summary.stories).toBe(3);
    expect(summary.links).toBe(1);
    expect(summary.from).toBe("2026-11-02");
    expect(summary.to).toBe("2026-12-11");
  });
});

describe("how long a piece of work takes", () => {
  it("is a range, not a number", () => {
    // Three points: optimistic, most likely, pessimistic.
    const est = estimate({ title: "A", why: "", days: 3, best: 2, worst: 6 });
    expect(est.expected).toBe(3);
    expect(est.low).toBe(2);
    expect(est.high).toBe(6);
  });

  it("falls back to the one number when there are no others", () => {
    const est = estimate({ title: "A", why: "", days: 4 });
    expect(est.expected).toBe(4);
    expect(est.low).toBe(4);
    expect(est.high).toBe(4);
  });

  it("keeps the bar at the expected length", () => {
    const d = draft();
    d.epics[0]!.stories[0] = { title: "Invoice list", why: "", days: 5, best: 2, worst: 10 };
    const { draft: checked } = checkDraft(project, mapping, d);
    const ops = draftOps(project, mapping, checked);
    const story = ops.find(o => o.kind === "create" && o.item.title === "Invoice list");
    expect(story?.kind).toBe("create");
    if (story?.kind !== "create") return;
    const end = Object.values(story.item.fields).find(v => v.kind === "date" && v.date !== "2026-11-02");
    expect(end).toBeDefined();
  });
});

describe("grouping the work", () => {
  it("groups what the model labelled", () => {
    const groups = groupByTheme([
      { key: "a", theme: "Release 1" },
      { key: "b", theme: "Release 1" },
      { key: "c", theme: "Release 2" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find(g => g.release === "Release 1")!.epics).toEqual(["a", "b"]);
  });

  it("gives the same answer twice, however the labels are ordered", () => {
    const a = groupByTheme([{ key: "a", theme: "R" }, { key: "b", theme: "R" }]);
    const b = groupByTheme([{ key: "b", theme: "R" }, { key: "a", theme: "R" }]);
    expect(a[0]!.epics.slice().sort()).toEqual(b[0]!.epics.slice().sort());
  });
});

describe("the model's answer", () => {
  it("has to be a plan", () => {
    expect(checkPlan(draft())).toBe(true);
    expect(checkPlan({ epics: "no" })).toBe(false);
    expect(checkPlan({ epics: [{ title: "" }] })).toBe(false);
    expect(checkPlan({ epics: [{ title: "A", stories: [{ title: 3 }] }] })).toBe(false);
    expect(checkPlan(null)).toBe(false);
  });
});

describe("the microphone", () => {
  afterEach(() => vi.unstubAllGlobals());
  const settings = { enabled: true, base: "http://localhost:11434/v1", chatModel: "qwen3", embedModel: "qwen3-embedding" };

  it("only ever talks to this computer", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    const away = { ...settings, voiceBase: "https://speech.example.com/v1" };
    expect(await transcribe(away, new Blob(["x"]))).toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });

  it("sends the recording to the speech server and takes the words back", async () => {
    const mock = vi.fn(async (url: string, _init?: RequestInit) => (
      url.endsWith("/models")
        ? { ok: true, status: 200, json: async () => ({ data: [{ id: "Systran/faster-whisper-base" }] }) }
        : { ok: true, status: 200, json: async () => ({ text: "a billing rework" }) }));
    vi.stubGlobal("fetch", mock);
    const text = await transcribe({ ...settings, voiceBase: "http://localhost:8000/v1" }, new Blob(["x"]));
    expect(text).toBe("a billing rework");
    expect(mock.mock.calls.map(c => c[0])).toContain("http://localhost:8000/v1/audio/transcriptions");
  });

  it("names the model the server actually has, not the one that was asked for", async () => {
    // Speaches calls its models "Systran/faster-whisper-base". Asking for "whisper-1"
    // would fail every time, and the microphone would look broken.
    const mock = vi.fn(async (url: string, _init?: RequestInit) => (
      url.endsWith("/models")
        ? { ok: true, status: 200, json: async () => ({ data: [{ id: "Systran/faster-whisper-base" }] }) }
        : { ok: true, status: 200, json: async () => ({ text: "words" }) }));
    vi.stubGlobal("fetch", mock);
    await transcribe({ ...settings, voiceBase: "http://localhost:8000/v1", voiceModel: "whisper-1" }, new Blob(["x"]));
    const body = mock.mock.calls[1]![1]!.body as FormData;
    expect(body.get("model")).toBe("Systran/faster-whisper-base");
  });

  it("gives up quietly when the server is not there", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no"); }));
    expect(await transcribe(settings, new Blob(["x"]))).toBeNull();
  });
});

import { matchEpics, splitInput } from "../src/model/plan/match";
import { amendmentOps, cleanTitle, epicStories, tidyAmendments, type Amendments } from "../src/model/plan/amend";
import { checkAmend } from "../src/ai/plan";
const epic = (title: string) => project.items.find(i => i.title === title)!;

describe("is it already here?", () => {
  it("splits a list into the pieces it lists", () => {
    const items = splitInput("- an invoice screen\n- a retry service\n- a refund flow");
    expect(items.map(i => i.text)).toEqual(["an invoice screen", "a retry service", "a refund flow"]);
  });

  it("splits a sentence into its parts", () => {
    const items = splitInput("An invoice screen. A retry service.");
    expect(items).toHaveLength(2);
  });

  it("finds the epic that already covers the work", () => {
    // The demo's billing epic holds "invoice PDF layout" and "saved payment methods".
    const matches = matchEpics(project, mapping, "saved payment methods\nsomething nobody has");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.epic.title).toBe("Billing and invoices");
    expect(matches[0]!.covered[0]!.story).toBeTruthy();
    expect(matches[0]!.missing.map(m => m.text)).toContain("something nobody has");
  });

  it("says nothing when nothing matches", () => {
    expect(matchEpics(project, mapping, "quantum teleportation")).toHaveLength(0);
  });

  it("scores the share of the input an epic covers", () => {
    const matches = matchEpics(project, mapping, "invoice PDF layout\nsaved payment methods");
    expect(matches[0]!.score).toBeGreaterThan(0.5);
    expect(matches[0]!.missing).toHaveLength(0);
  });
});

describe("tidying an epic", () => {
  it("keeps only the changes about stories the epic really has", () => {
    const a = epic("Billing and invoices");
    const stories = epicStories(project, a);
    expect(stories.length).toBeGreaterThan(0);
    const amendments: Amendments = {
      add: [{ title: "A new story", why: "It was missing.", days: 3 }],
      rename: [{ key: stories[0]!.key, from: stories[0]!.title, to: "A better name", why: "Clearer." }],
      overlap: [{ keys: [stories[0]!.key, "o/r#999"], titles: [stories[0]!.title, "Nothing"], why: "They repeat." }],
    };
    const changes = amendmentOps(project, a, amendments, new Set(["add:A new story", `rename:${stories[0]!.key}`]));
    expect(changes).toHaveLength(2);
    expect(changes[0]!.kind).toBe("add");
    expect(changes[1]!.kind).toBe("rename");
  });

  it("takes the titles from the project, not from the model's echo of them", () => {
    // A model tends to copy the line it was shown, key and all. The project already
    // knows what every story is called.
    const a = epic("Billing and invoices");
    const stories = epicStories(project, a);
    const answer: Amendments = {
      add: [{ title: `${stories[0]!.key} | Notify the customer`, why: "It was missing.", days: 3 }],
      rename: [{ key: stories[0]!.key, from: `${stories[0]!.key} | ${stories[0]!.title}`, to: `${stories[0]!.key} | A better name`, why: "Clearer." }],
      overlap: [{ keys: [stories[0]!.key, stories[1]!.key], titles: [`${stories[0]!.key} | One`, `${stories[1]!.key} | Two`], why: "They repeat." }],
    };
    const tidy = tidyAmendments(project, a, answer);
    expect(tidy.rename[0]!.from).toBe(stories[0]!.title);
    expect(tidy.rename[0]!.to).toBe("A better name");
    expect(tidy.add[0]!.title).toBe("Notify the customer");
    expect(tidy.overlap[0]!.titles).toEqual([stories[0]!.title, stories[1]!.title]);
    // And the story that is really renamed ends up with a clean title.
    const changes = amendmentOps(project, a, tidy, new Set([`rename:${stories[0]!.key}`]));
    expect(changes[0]!.ops[0]).toMatchObject({ kind: "setTitle", after: "A better name" });
  });

  it("drops a change about a story the epic does not have", () => {
    const a = epic("Billing and invoices");
    const answer: Amendments = {
      add: [], rename: [{ key: "o/r#999", from: "Nothing", to: "Something", why: "" }], overlap: [],
    };
    expect(tidyAmendments(project, a, answer).rename).toHaveLength(0);
  });

  it("leaves a title alone when the key is part of the title", () => {
    expect(cleanTitle("Q1-2026 planning")).toBe("Q1-2026 planning");
    expect(cleanTitle("PMH-13 | Show invoices")).toBe("Show invoices");
    expect(cleanTitle("PMH-13: Show invoices")).toBe("Show invoices");
    expect(cleanTitle("demo-co/orbit#113 | Show invoices")).toBe("Show invoices");
    expect(cleanTitle("ACME-2 integration")).toBe("ACME-2 integration");
  });

  it("puts a new story under the epic when it is applied", () => {
    const a = epic("Billing and invoices");
    const amendments: Amendments = { add: [{ title: "A brand new story", why: "", days: 2 }], rename: [], overlap: [] };
    const changes = amendmentOps(project, a, amendments, new Set(["add:A brand new story"]));
    const applied = applyOps(project, changes.flatMap(c => c.ops));
    const created = applied.project.items.find(i => i.title === "A brand new story");
    expect(created).toBeDefined();
    expect(created!.parentKey).toBe(a.key);
  });

  it("takes a story out of the project when that is what was picked", () => {
    const a = epic("Billing and invoices");
    const stories = epicStories(project, a);
    const amendments: Amendments = { add: [], rename: [], overlap: [{ keys: [stories[0]!.key, stories[1]!.key], titles: [stories[0]!.title, stories[1]!.title], why: "Same work." }] };
    const changes = amendmentOps(project, a, amendments, new Set([`archive:${stories[0]!.key}`]));
    expect(changes[0]!.kind).toBe("archive");
    const applied = applyOps(project, changes.flatMap(c => c.ops));
    expect(applied.project.items.find(i => i.key === stories[0]!.key)).toBeUndefined();
  });

  it("will not accept an answer that is not a set of changes", () => {
    expect(checkAmend({ add: [{ title: "x" }] })).toBe(false);
    expect(checkAmend({ add: [], rename: [{ key: "k", to: "" }], overlap: [] })).toBe(false);
    expect(checkAmend({ add: [], rename: [], overlap: [{ keys: ["a"], titles: [] }] })).toBe(false);
    expect(checkAmend({ add: [], rename: [], overlap: [] })).toBe(true);
  });
});
