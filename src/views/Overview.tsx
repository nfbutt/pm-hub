import { isEpic, laneOf, releaseOf, type Mapping } from "../model/mapping";
import type { Project } from "../model/normalize";

function describeMapping(m: Mapping): [string, string][] {
  const lane = m.lane.kind === "field" ? `Field “${m.lane.field}”` : m.lane.kind === "labelPrefix" ? `Labels starting “${m.lane.prefix}:”` : "None";
  const release = m.release.kind === "milestone" ? "Milestones" : m.release.kind === "iteration" ? `Iteration “${m.release.field}”`
    : m.release.kind === "field" ? `Field “${m.release.field}”` : "None";
  const epicRules = [m.epic.subIssues && "has sub-issues", m.epic.issueTypes.length && `issue type ${m.epic.issueTypes.join("/")}`, m.epic.label && `label “${m.epic.label}”`].filter(Boolean).join(", or ");
  return [
    ["Bar dates", [m.startField && `start “${m.startField}”`, m.endField && `end “${m.endField}”`, m.iterationField && `iteration “${m.iterationField}”`, m.milestoneDates && "milestone due date"].filter(Boolean).join(" → ") || "None found"],
    ["Epics", epicRules || "None"],
    ["Swimlanes", lane],
    ["Releases", release],
    ["Status", m.statusField ?? "None"],
    ["Priority", m.priority.kind === "field" ? `Field “${m.priority.field}”` : m.priority.kind === "labelPrefix" ? `Labels starting “${m.priority.prefix}:”` : "None"],
  ];
}

export function Overview({ project, mapping }: { project: Project; mapping: Mapping }) {
  const items = project.items;
  const open = items.filter(i => i.state === "open");
  const epics = items.filter(i => isEpic(i, mapping));
  const openEpics = epics.filter(i => i.state === "open");
  const dated = items.filter(i => (mapping.startField && i.fields[mapping.startField]) || (mapping.endField && i.fields[mapping.endField]));
  const inRelease = items.filter(i => releaseOf(i, mapping));
  const lanes = new Map<string, number>();
  for (const e of openEpics) { const l = laneOf(e, mapping) ?? "No lane"; lanes.set(l, (lanes.get(l) ?? 0) + 1); }

  const tiles: [string, number | string][] = [
    ["Items", items.length], ["Open", open.length], ["Open epics", openEpics.length],
    ["With dates", dated.length], ["In a release", inRelease.length], ["Drafts", items.filter(i => i.kind === "draft").length],
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="section-h">
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{project.title}</h1>
          {project.description && <p className="muted">{project.description}</p>}
        </div>
        <a className="btn" href={project.url} target="_blank" rel="noopener noreferrer">Open on GitHub ↗</a>
      </div>

      <div className="stats">
        {tiles.map(([l, v]) => <div key={l} className="card stat"><span className="v">{v}</span><span className="l">{l}</span></div>)}
      </div>

      <div className="grid2">
        <section className="card pad">
          <div className="section-h"><h2>How this project is read</h2><span className="muted" style={{ fontSize: 12 }}>Detected automatically</span></div>
          <table className="t"><tbody>
            {describeMapping(mapping).map(([k, v]) => <tr key={k}><th style={{ width: 120 }}>{k}</th><td>{v}</td></tr>)}
          </tbody></table>
        </section>
        <section className="card pad">
          <div className="section-h"><h2>Open epics by lane</h2></div>
          {lanes.size === 0 ? <p className="muted">No open epics found with the current rules.</p> : (
            <table className="t"><tbody>
              {[...lanes.entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => <tr key={l}><td>{l}</td><td className="num" style={{ textAlign: "right" }}>{n}</td></tr>)}
            </tbody></table>
          )}
        </section>
      </div>

      <section className="card pad">
        <div className="section-h"><h2>Open epics</h2><span className="muted num" style={{ fontSize: 12 }}>{openEpics.length}</span></div>
        <div className="tablewrap">
          <table className="t">
            <thead><tr><th>Epic</th><th>Lane</th><th>Progress</th><th>Sub-issues</th></tr></thead>
            <tbody>
              {openEpics.map(e => {
                const pct = e.subIssues ? Math.round((100 * e.subIssues.completed) / e.subIssues.total) : 0;
                return (
                  <tr key={e.id}>
                    <td>{e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer">{e.title}</a> : e.title} <span className="muted num" style={{ fontSize: 11 }}>{e.key}</span></td>
                    <td>{laneOf(e, mapping) ?? <span className="muted">—</span>}</td>
                    <td style={{ minWidth: 120 }}><div className="progress" role="img" aria-label={`${pct}% done`}><span style={{ width: `${pct}%` }} /></div></td>
                    <td className="num">{e.subIssues ? `${e.subIssues.completed}/${e.subIssues.total}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card pad">
        <div className="section-h"><h2>Fields</h2></div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {project.fields.map(f => <span key={f.id} className="pill">{f.name} · {f.kind}</span>)}
        </div>
      </section>
    </div>
  );
}
