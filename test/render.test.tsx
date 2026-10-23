// Renders every view with the demo project to catch runtime errors in render code.
import { renderToString as rawRender } from "react-dom/server";
import type { ReactElement } from "react";
const renderToString = (el: ReactElement) => rawRender(el).replace(/<!-- -->/g, "");
import { describe, expect, it } from "vitest";
import { detectMapping } from "../src/model/mapping";
import { emptyDraft } from "../src/model/schedule";
import { applyOps, datesOp } from "../src/model/ops";
import type { Editor } from "../src/views/useChangeSet";
import { defaultPrefs } from "../src/store/cache";
import { demoProject } from "../src/views/useProject";
import { Gantt } from "../src/views/Gantt";
import { Overview } from "../src/views/Overview";
import { Releases } from "../src/views/Releases";
import { Settings } from "../src/views/Settings";
import { Ai } from "../src/views/Ai";
import { Plan } from "../src/views/Plan";
import { ItemDrawer } from "../src/views/ItemDrawer";
import { CommandMenu } from "../src/ui/CommandMenu";
import { buildSchedule } from "../src/model/schedule";
import { Dependencies, layoutGraph } from "../src/views/Dependencies";
import { EpicMap } from "../src/views/EpicMap";
import { PeekCard } from "../src/views/epicmap/PeekCard";
import { analyze } from "../src/model/epicmap";
import { EpicLinks } from "../src/views/EpicLinks";
import { MeetingMode } from "../src/views/epicmap/MeetingMode";
import { Roadmap } from "../src/views/Roadmap";
import { Review } from "../src/views/Review";
import { Planner } from "../src/views/Planner";
import { Compare } from "../src/views/Compare";
import { AiStatus } from "../src/views/ai/AiStatus";
import { BurnUp } from "../src/views/BurnUp";
import { Confidence } from "../src/views/Confidence";
import { Progress } from "../src/views/Progress";
import { Schedule } from "../src/views/Schedule";
import { Workload } from "../src/views/Workload";
import { Changes } from "../src/views/Changes";
import { HistorySettings } from "../src/views/HistorySettings";
import type { HistoryState } from "../src/views/useHistory";

const project = demoProject();
const mapping = detectMapping(project);
const noop = () => {};

describe("views render with the demo project", () => {
  it("Epic Map, editable and read-only", () => {
    const editor: Editor = { base: project, record: noop, discard: noop, titleOf: k => k };
    const html = renderToString(<EpicMap project={project} mapping={mapping} draft={emptyDraft()} editor={editor} />);
    expect(html).toContain("Structure score");
    expect(html).toContain("Suggestions");
    expect(html).toContain("Accept");
    expect(html).toContain("Snooze");
    expect(html).toContain("Local analysis");
    expect(html).toContain("Quests");
    expect(html).toContain("Meeting mode");
    const ro = renderToString(<EpicMap project={project} mapping={mapping} draft={emptyDraft()} />);
    expect(ro).toContain("Read-only");
    expect(ro).not.toContain("Accept");
    expect(ro).not.toContain("Snooze");
  });

  it("The Epic Map's hover card gives the whole title, and a task's way to its issue", () => {
    const model = analyze(project, mapping, { openOnly: true });
    const items = new Map(project.items.map(i => [i.key, i]));
    const task = model.tasks.find(t => t.epicKey && items.get(t.key)?.url)!;
    const card = renderToString(<PeekCard peek={{ key: task.key, kind: "task", x: 200, y: 100 }} model={model} byKey={items} width={800} onOpen={noop} onEnter={noop} onLeave={noop} />);
    expect(card).toContain(task.title);
    expect(card).toContain(`href="${items.get(task.key)!.url}"`);
    expect(card).toContain(`in ${model.epics.find(e => e.key === task.epicKey)!.title}`);
    expect(card).toContain("Details");
    const epic = model.epics[0]!;
    const epicCard = renderToString(<PeekCard peek={{ key: epic.key, kind: "epic", x: 200, y: 300 }} model={model} byKey={items} width={800} onOpen={noop} onEnter={noop} onLeave={noop} />);
    expect(epicCard).toContain(epic.title);
    expect(epicCard).toContain(`${epic.taskKeys.length} task`);
  });

  it("Meeting mode shows one item at a time and a tally", () => {
    const html = renderToString(<MeetingMode agenda={[{ id: "a", kind: "epic", title: "Offline mode", why: "Mixes many kinds of work", focus: ["x"] }]}
      tally={{ moves: 1, merges: 0, epics: 0, score: 2 }} onClose={noop} onFocus={noop} onAccept={noop} reviewHref="#/review" readOnly={false} />);
    expect(html).toContain("Offline mode");
    expect(html).toContain("Item 1 of 1");
    expect(html).toContain("So far");
  });

  it("Roadmap puts every epic on a timeline and says whether the plan works", () => {
    const html = renderToString(<Roadmap project={project} mapping={mapping} draft={emptyDraft()} zoom="month" today="2026-10-19" />);
    expect(html).toContain("Roadmap");
    expect(html).toContain("Can this plan work?");
    expect(html).toContain("road-row");
  });

  it("Compare asks for two epics", () => {
    const html = renderToString(<Compare project={project} mapping={mapping} />);
    expect(html).toContain("Compare two epics");
    expect(html).toContain("First epic");
    expect(html).toContain("Second epic");
    expect(html).toContain("Choose two epics to compare");
  });

  it("The AI pill says whether the model is there", () => {
    const html = renderToString(<AiStatus settings={{ enabled: false, base: "", chatModel: "", embedModel: "" }} settingsHref="#/settings" />);
    expect(html).toContain("AI off");
    expect(html).toContain("ai-pill");
  });

  it("Planner asks what you are building and says what to do next", () => {
    const html = renderToString(<Planner project={project} mapping={mapping} />);
    expect(html).toContain("Planner");
    expect(html).toContain("Is it already here?");
    expect(html).toContain("Write it");
    expect(html).toContain("Tidy an epic");
    expect(html).toContain("What are you building?");
    // The microphone is always there: speaking needs a speech server, not a chat model.
    expect(html).toContain("Say it instead of typing it");
  });

  it("Review groups a bulk change into one row", () => {    const groups = [{
      id: "c1", label: "Accepted: Merge two epics",
      ops: [
        { kind: "setParent" as const, key: "o/r#1", before: "o/r#2", after: "o/r#3" },
        { kind: "archive" as const, key: "o/r#2" },
      ],
    }];
    const html = renderToString(<Review base={project} groups={groups} titleOf={k => k} client={null}
      onApplied={noop} onRecord={noop} refresh={noop} goBack={noop} mapping={mapping} scenario="Default" />);
    expect(html).toContain("Accepted: Merge two epics");
    expect(html).toContain("2 changes");
  });

  it("Overview", () => {
    const html = renderToString(<Overview project={project} mapping={mapping} />);
    expect(html).toContain("Orbit roadmap (demo)");
    expect(html).toContain("Open epics");
  });

  for (const zoom of ["week", "month", "quarter"] as const) {
    it(`Gantt at ${zoom} zoom`, () => {
      const html = renderToString(<Gantt project={project} mapping={mapping} draft={emptyDraft()} changed={0}
        prefs={{ ...defaultPrefs, zoom }} setPrefs={noop} />);
      expect(html).toContain("Usage-based pricing engine");
      expect(html).toContain("class=\"bar");
      expect(html).toContain("2 conflicts");
    });
  }

  it("Gantt with an edit shows where GitHub has the bar and the change count", () => {
    const epic = project.items.find(i => i.title === "Offline mode")!;
    const { project: edited, local } = applyOps(project, [datesOp(epic, mapping, "2027-03-01", "2027-04-30")]);
    const editor: Editor = { base: project, record: noop, discard: noop, titleOf: k => k };
    const html = renderToString(<Gantt project={edited} mapping={mapping} draft={local} editor={editor} changed={1} onDiscardAll={noop}
      prefs={defaultPrefs} setPrefs={noop} />);
    expect(html).toContain("class=\"ghostbar\"");
    expect(html).toContain("1 change, not on GitHub yet");
    expect(html).toContain("Discard changes");
  });

  it("Gantt without an editor is read-only", () => {
    const html = renderToString(<Gantt project={project} mapping={mapping} draft={emptyDraft()} changed={0} prefs={defaultPrefs} setPrefs={noop} />);
    expect(html).toContain("Showing GitHub only");
    expect(html).not.toContain("Discard changes");
  });

  it("Releases, editable and read-only", () => {
    const editor: Editor = { base: project, record: noop, discard: noop, titleOf: k => k };
    const html = renderToString(<Releases project={project} mapping={mapping} draft={emptyDraft()} editor={editor} />);
    expect(html).toContain("Release 2");
    expect(html).toContain("New release");
    expect(html).toContain("Needs attention");
    expect(html).toContain("Move to…");
    expect(html).toContain("Billing and invoices");
    expect(html).toContain('aria-label="Release 3 due date"');
    const ro = renderToString(<Releases project={project} mapping={mapping} draft={emptyDraft()} />);
    expect(ro).toContain("Release 2");
    expect(ro).not.toContain("New release");
    expect(ro).not.toContain("Move to…");
    expect(ro).not.toContain('type="date"');
  });

  it("Epic links, editable and read-only", () => {
    const editor: Editor = { base: project, record: noop, discard: noop, titleOf: k => k };
    const html = renderToString(<EpicLinks project={project} mapping={mapping} draft={emptyDraft()} editor={editor} />);
    expect(html).toContain("Epic links");
    expect(html).toContain("Suggested links");
    expect(html).toContain("Overlaps");
    expect(html).toContain("el-handle");
    expect(html).toContain("Overage charges depend on the usage-based pricing engine.");
    const ro = renderToString(<EpicLinks project={project} mapping={mapping} draft={emptyDraft()} />);
    expect(ro).not.toContain("el-handle");
    expect(ro).toContain("can’t be changed");
  });

  it("Progress", () => {
    const html = renderToString(<Progress project={project} mapping={mapping} draft={emptyDraft()} />);
    expect(html).toContain("Epic progress");
    expect(html).toContain("Usage-based pricing engine");
  });

  it("Status & workload", () => {
    const html = renderToString(<Workload project={project} mapping={mapping} draft={emptyDraft()} />);
    expect(html).toContain("Open items by status");
    expect(html).toContain("Unassigned");
  });

  it("Schedule", () => {
    const html = renderToString(<Schedule project={project} mapping={mapping} draft={emptyDraft()} />);
    expect(html).toContain("This month");
    expect(html).toContain("cal-day");
  });

  it("The AI setup says what to do, in order", () => {
    const html = renderToString(<Ai prefs={defaultPrefs} setPrefs={noop} />);
    expect(html).toContain("Set up the AI");
    expect(html).toContain("Where does the model run?");
    expect(html).toContain("Is it there?");
    expect(html).toContain("Which model?");
    expect(html).toContain("The microphone");
    expect(html).toContain("Does it work?");
    // The command a person needs, ready to copy.
    expect(html).toContain("ollama pull qwen2.5:7b");
  });

  it("Settings", () => {
    const html = renderToString(<Settings project={project} mapping={mapping} setMapping={noop} resetMapping={noop} prefs={defaultPrefs} setPrefs={noop}  aiHref="#/ai"/>);
    expect(html).toContain("Start date field");
  });
});

describe("forecast views render with the demo project", () => {
  it("Burn-up", () => {
    const html = renderToString(<BurnUp project={project} mapping={mapping} />);
    expect(html).toContain("Scope and done");
    expect(html).toContain("<svg");
  });
  it("Release confidence", () => {
    const html = renderToString(<Confidence project={project} mapping={mapping} />);
    expect(html).toContain("Release confidence");
    expect(html).toMatch(/chance of finishing by the due date|Done/);
  });
});

describe("dependency view", () => {
  it("lays out and renders the graph with the critical path", () => {
    const html = renderToString(<Dependencies project={project} mapping={mapping} draft={emptyDraft()} />);
    expect(html).toContain("<svg class=\"deps\"");
    expect(html).toContain("node cp");
  });
  it("lays every node inside the drawing", () => {
    const laid = layoutGraph({ nodes: project.items.filter(i => i.blockedBy.length || project.items.some(j => j.blockedBy.some(b => b.key === i.key))), edges: [] });
    for (const n of laid.nodes) { expect(n.x).toBeGreaterThan(0); expect(n.x).toBeLessThan(laid.width); }
  });
});

describe("editing surfaces render", () => {
  const editor: Editor = { base: project, record: noop, discard: noop, titleOf: k => k };
  it("Plan table, editable and read-only", () => {
    const html = renderToString(<Plan project={project} mapping={mapping} draft={emptyDraft()} editor={editor} selected={new Set()} onSelect={noop} />);
    expect(html).toContain("+ New epic");
    expect(html).toContain("cell-select");
    const ro = renderToString(<Plan project={project} mapping={mapping} draft={emptyDraft()} selected={new Set()} onSelect={noop} />);
    expect(ro).toContain("Read-only");
  });
  it("Plan bulk bar appears with a selection", () => {
    const keys = new Set(project.items.filter(i => i.parentKey).slice(0, 3).map(i => i.key));
    const html = renderToString(<Plan project={project} mapping={mapping} draft={emptyDraft()} editor={editor} selected={keys} onSelect={noop} />);
    expect(html).toContain("3 selected");
    expect(html).toContain("+1 week");
  });
  it("Item drawer shows editors when allowed", () => {
    const item = project.items.find(i => i.title === "Offline mode")!;
    const s = buildSchedule(project, mapping);
    const html = renderToString(<ItemDrawer item={item} project={project} mapping={mapping} schedule={s} original={s} conflicts={[]} editor={editor} onClose={noop} />);
    for (const t of ["Title", "Priority", "Lane", "Owners", "Epic", "Split…", "+ Story", "Add a blocker"]) expect(html, t).toContain(t);
  });
  it("Command menu lists selection actions", () => {
    const keys = new Set([project.items.find(i => i.title === "Offline mode")!.key]);
    const html = renderToString(<CommandMenu project={project} mapping={mapping} editor={editor} selected={keys} onSelect={noop} views={[{ id: "gantt", label: "Gantt" }]}
      go={noop} undo={noop} redo={noop} toggleGithubOnly={noop} onClose={noop} />);
    expect(html).toContain("Shift “Offline mode” +1 week");
    expect(html).toContain("Move “Offline mode” under an epic…");
  });

  const history: HistoryState = {
    config: { mode: "local" }, setConfig: noop, baselines: [], quests: [], proposals: [], changes: [
      { version: 1, at: "2026-03-01T00:00:00.000Z", author: "me", scenario: "Default", steps: [{ label: "Moved Orbit", status: "applied", kind: "setDates", reason: "vendor late" }] },
    ],
    loading: false, error: null, author: "me", reload: noop,
    saveBaseline: async () => {}, readBaseline: async () => { throw new Error("none"); }, saveChange: async () => {}, saveQuest: async () => {}, saveProposal: async () => {},
  };
  it("Changes", () => {
    const html = renderToString(<Changes base={project} edited={project} mapping={mapping} history={history} compareId={null} onCompare={noop} settingsHref="#" />);
    expect(html).toContain("What changed");
    expect(html).toContain("me applied 1 change");
    expect(html).toContain("vendor late");
  });
  it("History settings", () => {
    const html = renderToString(<HistorySettings history={history} owner="o" number={1} repos={["o/r"]} canShare />);
    expect(html).toContain(".pm-hub/o-1");
  });
  it("Gantt compares against a baseline", () => {
    const schedule = buildSchedule(project, mapping);
    const base = { version: 1 as const, name: "Old", savedAt: "2026-01-01T00:00:00.000Z", auto: false, project: { owner: "o", number: 1, title: "t" },
      items: project.items.map(i => ({ key: i.key, title: i.title, parentKey: i.parentKey, epic: true, state: i.state, start: null,
        end: schedule.bars.get(i.key) ? "2020-01-01" : null, release: null, lane: null, sub: null })) };
    const html = renderToString(<Gantt project={project} mapping={mapping} draft={emptyDraft()} changed={0} prefs={defaultPrefs} setPrefs={noop}
      baselines={[{ id: "x", name: "Old", savedAt: base.savedAt, auto: false }]} compare={{ id: "x", baseline: base }} onCompare={noop} />);
    expect(html).toContain("basebar");
    expect(html).toContain("Compare to");
  });
});
