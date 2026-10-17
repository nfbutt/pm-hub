import { useMemo, useState } from "react";
import type { Mapping } from "../model/mapping";
import type { Item, Project } from "../model/normalize";
import { buildSchedule, findConflicts, releaseColumns, type Draft } from "../model/schedule";
import { ItemDrawer } from "./ItemDrawer";

const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const today = () => new Date().toISOString().slice(0, 10);

export function Releases({ project, mapping, draft }: { project: Project; mapping: Mapping; draft: Draft }) {
  const schedule = useMemo(() => buildSchedule(project, mapping, draft), [project, mapping, draft]);
  const original = useMemo(() => buildSchedule(project, mapping), [project, mapping]);
  const conflicts = useMemo(() => findConflicts(schedule, draft), [schedule, draft]);
  const columns = useMemo(() => releaseColumns(project, mapping, schedule), [project, mapping, schedule]);
  const [showDone, setShowDone] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const openItem = open ? schedule.byKey.get(open) : null;

  if (mapping.release.kind === "none") {
    return <div className="card pad"><p>This project has no releases set up. Add milestones or an iteration field on GitHub, or pick one in <a href={location.hash.replace(/\/[a-z]+$/, "/settings")}>Settings</a>.</p></div>;
  }
  if (!columns.length) return <div className="card pad"><p className="muted">No items are assigned to a release yet.</p></div>;

  const groupByParent = (items: Item[]) => {
    const g = new Map<string, Item[]>();
    for (const i of items) { const k = i.parentKey ?? ""; if (!g.has(k)) g.set(k, []); g.get(k)!.push(i); }
    return [...g.entries()].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : 0));
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="toolbar" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="muted">{columns.length} releases · ordered by due date</span>
        <span style={{ flex: 1 }} />
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <input id="r-done" type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> Show finished releases
        </label>
      </div>
      <div className="rel-grid">
        {columns.filter(c => showDone || c.done < c.items.length).map(c => {
          const pct = c.items.length ? Math.round((100 * c.done) / c.items.length) : 0;
          const overdue = c.due && c.due < today() && c.done < c.items.length;
          const lateKeys = new Set(c.late.map(i => i.key));
          return (
            <section key={c.id} className="card rcol">
              <div className="rhead">
                <div className="section-h" style={{ marginBottom: 0 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 800 }}>{c.title}</h3>
                  {c.due ? <span className={`num ${overdue ? "pill bad" : "muted"}`} style={{ fontSize: 12 }}>{overdue ? "Overdue · " : "Due "}{fmt(c.due)}</span> : <span className="muted" style={{ fontSize: 12 }}>No due date</span>}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div className="progress" style={{ flex: 1 }}><span style={{ width: `${pct}%` }} /></div>
                  <span className="num" style={{ fontSize: 12 }}>{c.done}/{c.items.length}</span>
                </div>
                {c.late.length > 0 && <span className="pill warn">{c.late.length} item{c.late.length > 1 ? "s" : ""} scheduled to finish after the due date</span>}
              </div>
              {groupByParent(c.items).map(([parent, items]) => (
                <div key={parent || "none"} className="rgroup">
                  <h4>{parent ? schedule.byKey.get(parent)?.title ?? parent : "Not under an epic"}</h4>
                  {items.sort((a, b) => Number(a.state !== "open") - Number(b.state !== "open")).map(i => (
                    <div key={i.key} className={`story ${lateKeys.has(i.key) ? "late" : ""}`}>
                      <span className={i.state === "open" ? (lateKeys.has(i.key) ? "pill warn" : "pill") : "pill good"}>{i.state === "open" ? (lateKeys.has(i.key) ? "Late" : "Open") : "Done"}</span>
                      <button className="linkish" onClick={() => setOpen(i.key)} title={i.title}>{i.title}</button>
                    </div>
                  ))}
                </div>
              ))}
            </section>
          );
        })}
      </div>
      {openItem && <ItemDrawer item={openItem} mapping={mapping} schedule={schedule} original={original} conflicts={conflicts} onClose={() => setOpen(null)} />}
    </div>
  );
}
