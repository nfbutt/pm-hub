import { useMemo, useState } from "react";
import { hygiene, statusCounts, workload } from "../model/health";
import { addDays, type Mapping } from "../model/mapping";
import type { Item, Project } from "../model/normalize";
import { buildSchedule, findConflicts, type Draft } from "../model/schedule";
import { ItemDrawer } from "./ItemDrawer";

const today = () => new Date().toISOString().slice(0, 10);
const mondayOf = (d: string) => addDays(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7));
const WEEKS = 10;

export function Workload({ project, mapping, draft }: { project: Project; mapping: Mapping; draft: Draft }) {
  const schedule = useMemo(() => buildSchedule(project, mapping, draft), [project, mapping, draft]);
  const original = useMemo(() => buildSchedule(project, mapping), [project, mapping]);
  const weeks = useMemo(() => Array.from({ length: WEEKS }, (_, k) => addDays(mondayOf(today()), (k - 1) * 7)), []);
  const status = useMemo(() => statusCounts(project, mapping), [project, mapping]);
  const people = useMemo(() => workload(project, schedule, weeks), [project, schedule, weeks]);
  const hyg = useMemo(() => hygiene(project, mapping, schedule, today()), [project, mapping, schedule]);
  const [open, setOpen] = useState<string | null>(null);
  const [list, setList] = useState<keyof typeof hyg>("noDates");
  const maxStatus = Math.max(1, ...status.map(s => s.count));
  const maxLoad = Math.max(1, ...people.flatMap(p => p.weekly));
  const openItem = open ? schedule.byKey.get(open) : null;

  const LISTS: [keyof typeof hyg, string, string][] = [
    ["noDates", "No dates", "Open items that won't appear on the Gantt or calendar."],
    ["noAssignee", "No owner", "Open issues and PRs nobody is assigned to (epics excluded)."],
    ["noRelease", "No release", "Open items not in any release."],
    ["stale", "Quiet 30+ days", "Open items with no update in the last 30 days."],
    ["blockedByClosed", "Blocker already done", "Still marked blocked by an issue that is closed. The link can probably go."],
  ];
  const current = LISTS.find(l => l[0] === list)!;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="grid2">
        <section className="card pad">
          <div className="section-h"><h2>Open items by status</h2><span className="muted num" style={{ fontSize: 12 }}>{status.reduce((n, s) => n + s.count, 0)}</span></div>
          {mapping.statusField ? (
            <div style={{ display: "grid", gap: 8 }}>
              {status.map(s => (
                <div key={s.status} className="hbar">
                  <span className="hbar-l">{s.status}</span>
                  <span className="hbar-t"><span style={{ width: `${(100 * s.count) / maxStatus}%` }} /></span>
                  <span className="num">{s.count}</span>
                </div>
              ))}
            </div>
          ) : <p className="muted">No status field selected. Choose one in Settings.</p>}
        </section>

        <section className="card pad">
          <div className="section-h"><h2>Needs attention</h2></div>
          <div className="seg wrap" role="tablist" aria-label="Lists">
            {LISTS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={k === list} className={k === list ? "on" : ""} onClick={() => setList(k)}>
                {label} <span className="num">{hyg[k].length}</span>
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, margin: "8px 0" }}>{current[2]}</p>
          <ItemList items={hyg[list]} onOpen={setOpen} />
        </section>
      </div>

      <section className="card pad">
        <div className="section-h">
          <h2>Workload by person</h2>
          <span className="muted" style={{ fontSize: 12 }}>Open items per week, from their dates. Last week through the next {WEEKS - 2} weeks.</span>
        </div>
        <div className="tablewrap">
          <table className="t heat">
            <thead>
              <tr><th>Person</th><th>Open</th>
                {weeks.map(w => <th key={w} className="num" style={{ textAlign: "center" }}>{new Date(w + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}</th>)}
              </tr>
            </thead>
            <tbody>
              {people.map(p => (
                <tr key={p.login}>
                  <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{p.login}</td>
                  <td className="num">{p.open.length}</td>
                  {p.weekly.map((n, i) => (
                    <td key={i} className="num cell" style={{ ["--a" as string]: n / maxLoad }} title={`${n} item${n === 1 ? "" : "s"} in the week of ${weeks[i]}`}>{n || ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {openItem && <ItemDrawer item={openItem} mapping={mapping} schedule={schedule} original={original} conflicts={findConflicts(schedule, draft)} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ItemList({ items, onOpen }: { items: Item[]; onOpen: (k: string) => void }) {
  const [all, setAll] = useState(false);
  if (!items.length) return <p className="pill good">Nothing here</p>;
  const shown = all ? items : items.slice(0, 12);
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {shown.map(i => (
        <div key={i.key} className="story">
          <span className="muted num" style={{ fontSize: 11, minWidth: 48 }}>{i.number ? `#${i.number}` : i.kind}</span>
          <button className="linkish" onClick={() => onOpen(i.key)} title={i.title}>{i.title}</button>
        </div>
      ))}
      {items.length > 12 && <button className="btn" style={{ justifySelf: "start" }} onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${items.length}`}</button>}
    </div>
  );
}
