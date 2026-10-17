import { useMemo, useState } from "react";
import { burnup, forecastInputs, linearProjection, weeklyThroughput, workItems } from "../model/forecast";
import { addDays, releaseOf, type Mapping } from "../model/mapping";
import type { Project } from "../model/normalize";
import { BarChart, LineChart } from "../ui/charts";

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function BurnUp({ project, mapping }: { project: Project; mapping: Mapping }) {
  const releases = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const i of workItems(project, mapping)) { const r = releaseOf(i, mapping); if (r && !seen.has(r.title)) seen.set(r.title, r.due); }
    return [...seen.entries()].sort((a, b) => (a[1] ?? "9999").localeCompare(b[1] ?? "9999"));
  }, [project, mapping]);
  const [release, setRelease] = useState("");
  const items = useMemo(() => workItems(project, mapping).filter(i => !release || releaseOf(i, mapping)?.title === release), [project, mapping, release]);
  const points = useMemo(() => burnup(items, today()), [items]);
  const through = useMemo(() => weeklyThroughput(items, today(), 12), [items]);
  const inputs = useMemo(() => forecastInputs(project, mapping, today()), [project, mapping]);
  const recent = through.slice(-6).map(t => t.closed);
  const open = items.filter(i => i.state === "open").length;
  const proj = linearProjection(open, recent, today());
  const due = release ? releases.find(r => r[0] === release)?.[1] ?? null : null;

  // Extend the x axis with the projection so the dashed line has room.
  const x = points.map(p => p.weekStart);
  const extra: string[] = [];
  if (proj && proj.weeks > 0) for (let k = 1; k <= Math.min(proj.weeks, 26); k++) extra.push(addDays(x[x.length - 1] ?? today(), 7 * k));
  const axis = [...x, ...extra];
  const last = points[points.length - 1];
  const projection = last && proj && proj.weeks > 0
    ? axis.map((_, i) => (i < x.length - 1 ? null : Math.min(last.scope, last.done + proj.rate * (i - (x.length - 1)))))
    : [];
  const dueIdx = due ? axis.findIndex(w => w > due) : -1;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="section-h">
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800 }}>Burn-up</h1>
          <p className="muted" style={{ maxWidth: "75ch" }}>Scope is every work item created so far; done is every one closed. The gap between the lines is what's left. Epics are left out because they close when their parts do.</p>
        </div>
        <label className="setting" style={{ minWidth: 220 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Release</span>
          <select id="bu-release" className="input" style={{ fontFamily: "var(--f-body)" }} value={release} onChange={e => setRelease(e.target.value)}>
            <option value="">Whole project</option>
            {releases.map(([t]) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      <div className="stats">
        <div className="card stat"><span className="v">{items.length}</span><span className="l">Work items</span></div>
        <div className="card stat"><span className="v">{open}</span><span className="l">Still open</span></div>
        <div className="card stat"><span className="v">{proj ? proj.rate.toFixed(1) : "0"}</span><span className="l">Closed per week (last 6)</span></div>
        <div className="card stat"><span className="v" style={{ fontSize: 18 }}>{open === 0 ? "Done" : proj ? fmt(proj.date) : "—"}</span><span className="l">Finish at that pace{due ? ` · due ${fmt(due)}` : ""}</span></div>
      </div>

      <section className="card pad">
        <div className="section-h"><h2>Scope and done</h2>
          <span className="legend"><span className="key" style={{ background: "var(--muted)" }} /> Scope <span className="key" style={{ background: "var(--accent)" }} /> Done <span className="key dashed" /> Projection</span>
        </div>
        {points.length < 2 ? <p className="muted">Not enough history yet.</p> : (
          <LineChart x={axis} label="Burn-up chart" height={260}
            markers={dueIdx > 0 ? [{ at: dueIdx - 1, label: "Due", color: "var(--today)" }] : []}
            series={[
              { name: "Scope", color: "var(--muted)", values: points.map(p => p.scope) },
              { name: "Done", color: "var(--accent)", values: points.map(p => p.done), area: true },
              ...(projection.length ? [{ name: "Projection", color: "var(--accent)", values: projection, dashed: true }] : []),
            ]} />
        )}
        {!proj && open > 0 && <p className="callout warn" style={{ marginTop: 8 }}>Nothing was closed in the last 6 weeks, so there's no pace to project from.</p>}
      </section>

      <section className="card pad">
        <div className="section-h"><h2>Closed per week</h2><span className="muted" style={{ fontSize: 12 }}>Last 12 full weeks. The darker 6 drive the projection.</span></div>
        <BarChart labels={through.map(t => new Date(t.weekStart + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }))}
          values={through.map(t => t.closed)} color="var(--accent)" label="Items closed per week" highlightFrom={6} />
        {inputs.thin && <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Only {inputs.closedInHistory} items closed over {inputs.weeksOfHistory} active weeks. Treat forecasts as rough.</p>}
      </section>
    </div>
  );
}
