import { useMemo, useState } from "react";
import { allEpicHealth, AT_RISK_AT, BEHIND_AT, type Health } from "../model/health";
import type { Mapping } from "../model/mapping";
import type { Project } from "../model/normalize";
import { buildSchedule, findConflicts, type Draft } from "../model/schedule";
import { ItemDrawer } from "./ItemDrawer";

export const HEALTH_LABEL: Record<Health, string> = {
  overdue: "Overdue", "at-risk": "At risk", behind: "Behind", "on-track": "On track", "not-started": "Not started", "no-dates": "No dates", done: "Done",
};
export const HEALTH_PILL: Record<Health, string> = {
  overdue: "pill bad", "at-risk": "pill bad", behind: "pill warn", "on-track": "pill good", "not-started": "pill", "no-dates": "pill", done: "pill good",
};
const today = () => new Date().toISOString().slice(0, 10);
const short = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

export function Progress({ project, mapping, draft }: { project: Project; mapping: Mapping; draft: Draft }) {
  const schedule = useMemo(() => buildSchedule(project, mapping, draft), [project, mapping, draft]);
  const original = useMemo(() => buildSchedule(project, mapping), [project, mapping]);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => allEpicHealth(project, mapping, schedule, today(), includeClosed), [project, mapping, schedule, includeClosed]);
  const counts = rows.reduce<Record<string, number>>((acc, r) => { acc[r.health] = (acc[r.health] ?? 0) + 1; return acc; }, {});
  const openItem = open ? schedule.byKey.get(open) : null;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="section-h">
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800 }}>Epic progress</h1>
          <p className="muted" style={{ maxWidth: "75ch" }}>
            Each bar compares work done (sub-issues closed) with time passed in the epic's window. More than {BEHIND_AT} points of time
            ahead of work is <b>Behind</b>; more than {AT_RISK_AT} is <b>At risk</b>.
          </p>
        </div>
        <label className="check-row"><input id="pr-closed" type="checkbox" checked={includeClosed} onChange={e => setIncludeClosed(e.target.checked)} /> Show finished epics</label>
      </div>

      <div className="stats">
        {(["overdue", "at-risk", "behind", "on-track", "not-started", "no-dates"] as Health[]).map(h => (
          <div key={h} className="card stat"><span className="v">{counts[h] ?? 0}</span><span className="l"><span className={HEALTH_PILL[h]}>{HEALTH_LABEL[h]}</span></span></div>
        ))}
      </div>

      <section className="card">
        <div className="tablewrap">
          <table className="t progress-table">
            <thead><tr><th>Epic</th><th>Health</th><th style={{ minWidth: 220 }}>Work done vs. time passed</th><th>Done</th><th>Window</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.item.key}>
                  <td>
                    <button className="linkish" style={{ fontWeight: 600 }} onClick={() => setOpen(r.item.key)} title={r.item.title}>{r.item.title}</button>
                    {r.lane && <div className="muted" style={{ fontSize: 12 }}>{r.lane}</div>}
                  </td>
                  <td><span className={HEALTH_PILL[r.health]}>{HEALTH_LABEL[r.health]}</span></td>
                  <td>
                    <div className="vs" role="img" aria-label={`${r.pctDone}% done, ${r.pctTime ?? 0}% of time passed`}>
                      <span className="vs-done" style={{ width: `${r.pctDone}%` }} />
                      {r.pctTime !== null && <span className="vs-time" style={{ left: `${r.pctTime}%` }} title={`${r.pctTime}% of time passed`} />}
                    </div>
                    <div className="muted num" style={{ fontSize: 11, marginTop: 3 }}>{r.pctDone}% done{r.pctTime !== null && ` · ${r.pctTime}% of time`}</div>
                  </td>
                  <td className="num">{r.total ? `${r.done}/${r.total}` : "—"}</td>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>
                    {r.start && r.end ? `${short(r.start)} – ${short(r.end)}` : "—"}
                    {r.daysLeft !== null && r.health !== "done" && <div className="muted" style={{ fontSize: 11 }}>{r.daysLeft >= 0 ? `${r.daysLeft} days left` : `${-r.daysLeft} days late`}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <p className="muted" style={{ padding: 16 }}>No epics found.</p>}
      </section>
      {openItem && <ItemDrawer item={openItem} mapping={mapping} schedule={schedule} original={original} conflicts={findConflicts(schedule, draft)} onClose={() => setOpen(null)} />}
    </div>
  );
}
