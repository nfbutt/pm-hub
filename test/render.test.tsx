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

  it("Settings", () => {
    const html = renderToString(<Settings project={project} mapping={mapping} setMapping={noop} resetMapping={noop} prefs={defaultPrefs} setPrefs={noop} />);
    expect(html).toContain("Start date field");
  });
});
