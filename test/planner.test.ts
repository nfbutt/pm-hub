// The planner: what the model drafts, the checks it has to pass, and the changes it
// becomes. And the microphone: it only ever talks to this computer.
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { normalizeProject } from "../src/model/normalize";
import { detectMapping } from "../src/model/mapping";
import { applyOps } from "../src/model/ops";
import { checkDraft, draftOps, MAX_DRAFT_ITEMS, summariseDraft, type PlanDraft } from "../src/model/plan/draft";
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
    const mock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => ({ text: "a billing rework" }) }));
    vi.stubGlobal("fetch", mock);
    const text = await transcribe({ ...settings, voiceBase: "http://localhost:8000/v1" }, new Blob(["x"]));
    expect(text).toBe("a billing rework");
    expect(mock.mock.calls[0]![0]).toBe("http://localhost:8000/v1/audio/transcriptions");
  });

  it("gives up quietly when the server is not there", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no"); }));
    expect(await transcribe(settings, new Blob(["x"]))).toBeNull();
  });
});
