import { labelPrefixes, type LaneRule, type Mapping, type ReleaseRule } from "../model/mapping";
import type { Project } from "../model/normalize";
import type { Prefs } from "../store/cache";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function Settings({ project, mapping, setMapping, resetMapping, prefs, setPrefs }: {
  project: Project; mapping: Mapping; setMapping: (m: Mapping) => void; resetMapping: () => void; prefs: Prefs; setPrefs: (p: Prefs) => void;
}) {
  const names = (kind: string) => project.fields.filter(f => f.kind === kind).map(f => f.name);
  const dates = names("date"), singles = names("single"), iterations = names("iteration");
  const prefixes = [...labelPrefixes(project).entries()].filter(([, v]) => v.size >= 2).map(([k]) => k).sort();
  const epicLabels = [...new Set(project.items.flatMap(i => i.labels))].filter(l => /epic/i.test(l)).sort();
  const issueTypes = [...new Set(project.items.map(i => i.issueType).filter((t): t is string => !!t))].sort();
  const set = (patch: Partial<Mapping>) => setMapping({ ...mapping, ...patch });

  const laneValue = mapping.lane.kind === "field" ? `field:${mapping.lane.field}` : mapping.lane.kind === "labelPrefix" ? `prefix:${mapping.lane.prefix}` : "none";
  const releaseValue = mapping.release.kind === "milestone" ? "milestone" : mapping.release.kind === "iteration" ? `iteration:${mapping.release.field}`
    : mapping.release.kind === "field" ? `field:${mapping.release.field}` : "none";
  const prioValue = mapping.priority.kind === "field" ? `field:${mapping.priority.field}` : mapping.priority.kind === "labelPrefix" ? `prefix:${mapping.priority.prefix}` : "none";

  const parseLane = (v: string): LaneRule => v.startsWith("field:") ? { kind: "field", field: v.slice(6) } : v.startsWith("prefix:") ? { kind: "labelPrefix", prefix: v.slice(7) } : { kind: "none" };
  const parseRelease = (v: string): ReleaseRule => v === "milestone" ? { kind: "milestone" } : v.startsWith("iteration:") ? { kind: "iteration", field: v.slice(10) }
    : v.startsWith("field:") ? { kind: "field", field: v.slice(6) } : { kind: "none" };

  const Select = ({ id, label, value, onChange, options, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][]; hint?: string }) => (
    <div className="setting">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={e => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hint && <span className="muted">{hint}</span>}
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 860 }}>
      <div className="section-h">
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>How this project is read</h1>
          <p className="muted">These were detected automatically. Changes are saved in this browser for this project only.</p>
        </div>
        <button className="btn" onClick={resetMapping}>Detect again</button>
      </div>

      <section className="card pad settings">
        <h2>Bars</h2>
        <Select id="m-start" label="Start date field" value={mapping.startField ?? ""} onChange={v => set({ startField: v || null })}
          options={[["", "None"], ...dates.map(d => [d, d] as [string, string])]} />
        <Select id="m-end" label="End date field" value={mapping.endField ?? ""} onChange={v => set({ endField: v || null })}
          options={[["", "None"], ...dates.map(d => [d, d] as [string, string])]} />
        <Select id="m-iter" label="Iteration fallback" value={mapping.iterationField ?? ""} onChange={v => set({ iterationField: v || null })}
          options={[["", "None"], ...iterations.map(d => [d, d] as [string, string])]} hint="Used for items without dates." />
        <label className="check-row"><input id="m-ms" type="checkbox" checked={mapping.milestoneDates} onChange={e => set({ milestoneDates: e.target.checked })} />
          Use the milestone due date when nothing else is set</label>
      </section>

      <section className="card pad settings">
        <h2>Epics</h2>
        <label className="check-row"><input id="m-subs" type="checkbox" checked={mapping.epic.subIssues} onChange={e => set({ epic: { ...mapping.epic, subIssues: e.target.checked } })} />
          Any issue with sub-issues is an epic</label>
        <Select id="m-elabel" label="Label that marks an epic" value={mapping.epic.label ?? ""} onChange={v => set({ epic: { ...mapping.epic, label: v || null } })}
          options={[["", "None"], ...epicLabels.map(l => [l, l] as [string, string])]} />
        {issueTypes.length > 0 && (
          <fieldset className="setting">
            <legend>Issue types that are epics</legend>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {issueTypes.map(t => (
                <label key={t} className="check-row"><input type="checkbox" checked={mapping.epic.issueTypes.includes(t)}
                  onChange={e => set({ epic: { ...mapping.epic, issueTypes: e.target.checked ? [...mapping.epic.issueTypes, t] : mapping.epic.issueTypes.filter(x => x !== t) } })} /> {t}</label>
              ))}
            </div>
          </fieldset>
        )}
      </section>

      <section className="card pad settings">
        <h2>Grouping</h2>
        <Select id="m-lane" label="Swimlanes" value={laneValue} onChange={v => set({ lane: parseLane(v) })}
          options={[["none", "None"], ...singles.map(s => [`field:${s}`, `Field: ${s}`] as [string, string]), ...prefixes.map(p => [`prefix:${p}`, `Labels starting “${p}:”`] as [string, string])]} />
        <Select id="m-rel" label="Releases" value={releaseValue} onChange={v => set({ release: parseRelease(v) })}
          options={[["none", "None"], ["milestone", "Milestones"], ...iterations.map(s => [`iteration:${s}`, `Iteration: ${s}`] as [string, string]), ...singles.map(s => [`field:${s}`, `Field: ${s}`] as [string, string])]} />
        <Select id="m-status" label="Status field" value={mapping.statusField ?? ""} onChange={v => set({ statusField: v || null })}
          options={[["", "None"], ...singles.map(s => [s, s] as [string, string])]} />
        <Select id="m-prio" label="Priority" value={prioValue}
          onChange={v => set({ priority: v.startsWith("field:") ? { kind: "field", field: v.slice(6) } : v.startsWith("prefix:") ? { kind: "labelPrefix", prefix: v.slice(7) } : { kind: "none" } })}
          options={[["none", "None"], ...singles.map(s => [`field:${s}`, `Field: ${s}`] as [string, string]), ...prefixes.map(p => [`prefix:${p}`, `Labels starting “${p}:”`] as [string, string])]} />
      </section>

      <section className="card pad settings">
        <h2>Calendar</h2>
        <Select id="p-fy" label="Fiscal year starts in" value={String(prefs.fyStartMonth)} onChange={v => setPrefs({ ...prefs, fyStartMonth: Number(v) })}
          options={MONTHS.map((m, i) => [String(i + 1), i === 0 ? "January (calendar year)" : i === 9 ? "October (US federal)" : m] as [string, string])}
          hint="Changes the quarter labels on the timeline. Applies to every project." />
      </section>
    </div>
  );
}
