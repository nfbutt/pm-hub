// Renders every view with the demo project to catch runtime errors in render code.
import { renderToString as rawRender } from "react-dom/server";
import type { ReactElement } from "react";
const renderToString = (el: ReactElement) => rawRender(el).replace(/<!-- -->/g, "");
import { describe, expect, it } from "vitest";
import { detectMapping } from "../src/model/mapping";
import { emptyDraft } from "../src/model/schedule";
import { defaultPrefs } from "../src/store/cache";
import { demoProject } from "../src/views/useProject";
import { Gantt } from "../src/views/Gantt";
import { Overview } from "../src/views/Overview";
import { Releases } from "../src/views/Releases";
import { Settings } from "../src/views/Settings";
import { Dependencies, layoutGraph } from "../src/views/Dependencies";
import { BurnUp } from "../src/views/BurnUp";
import { Confidence } from "../src/views/Confidence";
import { Progress } from "../src/views/Progress";
import { Schedule } from "../src/views/Schedule";
import { Workload } from "../src/views/Workload";

const project = demoProject();
const mapping = detectMapping(project);
const noop = () => {};

describe("views render with the demo project", () => {
  it("Overview", () => {
    const html = renderToString(<Overview project={project} mapping={mapping} />);
    expect(html).toContain("Orbit roadmap (demo)");
    expect(html).toContain("Open epics");
  });

  for (const zoom of ["week", "month", "quarter"] as const) {
    it(`Gantt at ${zoom} zoom`, () => {
      const html = renderToString(<Gantt project={project} mapping={mapping} draft={emptyDraft()} setDraft={noop} resetDraft={noop} changed={0}
        prefs={{ ...defaultPrefs, zoom }} setPrefs={noop} />);
      expect(html).toContain("Usage-based pricing engine");
      expect(html).toContain("class=\"bar");
      expect(html).toContain("2 conflicts");
    });
  }

  it("Gantt with a draft shows the ghost bar and the change count", () => {
    const epic = project.items.find(i => i.title === "Offline mode")!;
    const html = renderToString(<Gantt project={project} mapping={mapping} draft={{ ...emptyDraft(), bars: { [epic.key]: { start: "2027-03-01", end: "2027-04-30" } } }}
      setDraft={noop} resetDraft={noop} changed={1} prefs={defaultPrefs} setPrefs={noop} />);
    expect(html).toContain("class=\"ghostbar\"");
    expect(html).toContain("Draft: 1 change");
  });

  it("Releases", () => {
    const html = renderToString(<Releases project={project} mapping={mapping} draft={emptyDraft()} />);
    expect(html).toContain("Release 2");
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

  it("Settings", () => {
    const html = renderToString(<Settings project={project} mapping={mapping} setMapping={noop} resetMapping={noop} prefs={defaultPrefs} setPrefs={noop} />);
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
