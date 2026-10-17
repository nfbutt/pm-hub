import { useMemo, useState } from "react";
import { calendarEvents, monthGrid, type CalEvent } from "../model/health";
import type { Mapping } from "../model/mapping";
import type { Project } from "../model/normalize";
import { buildSchedule, findConflicts, type Draft } from "../model/schedule";
import { ItemDrawer } from "./ItemDrawer";

const today = () => new Date().toISOString().slice(0, 10);
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KIND_LABEL: Record<CalEvent["kind"], string> = { release: "Due", iteration: "Begins", start: "Starts", end: "Ends" };

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export function Schedule({ project, mapping, draft }: { project: Project; mapping: Mapping; draft: Draft }) {
  const schedule = useMemo(() => buildSchedule(project, mapping, draft), [project, mapping, draft]);
  const original = useMemo(() => buildSchedule(project, mapping), [project, mapping]);
  const [epicsOnly, setEpicsOnly] = useState(true);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [open, setOpen] = useState<string | null>(null);
  const events = useMemo(() => calendarEvents(project, mapping, schedule, { epicsOnly }), [project, mapping, schedule, epicsOnly]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) { if (!m.has(e.date)) m.set(e.date, []); m.get(e.date)!.push(e); }
    return m;
  }, [events]);
  const grid = monthGrid(month);
  const monthEvents = events.filter(e => e.date.startsWith(month));
  const title = new Date(month + "-01T00:00:00Z").toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const openItem = open ? schedule.byKey.get(open) : null;

  const Ev = ({ e }: { e: CalEvent }) => (
    <button className={`cal-ev ${e.kind}`} onClick={() => e.key && setOpen(e.key)} disabled={!e.key} title={`${KIND_LABEL[e.kind]}: ${e.label}`}>
      <span className="cal-k">{KIND_LABEL[e.kind]}</span> {e.label}
    </button>
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="toolbar" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">←</button>
        <h1 style={{ fontSize: 18, fontWeight: 800, minWidth: 150, textAlign: "center" }}>{title}</h1>
        <button className="btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">→</button>
        <button className="btn" onClick={() => setMonth(today().slice(0, 7))}>Today</button>
        <span style={{ flex: 1 }} />
        <label className="check-row"><input id="cal-epics" type="checkbox" checked={epicsOnly} onChange={e => setEpicsOnly(e.target.checked)} /> Epics only</label>
      </div>

      <div className="card cal">
        <div className="cal-grid cal-head">{DOW.map(d => <div key={d}>{d}</div>)}</div>
        <div className="cal-grid">
          {grid.map(d => {
            const evs = byDay.get(d) ?? [];
            return (
              <div key={d} className={`cal-day ${d.startsWith(month) ? "" : "out"} ${d === today() ? "now" : ""}`}>
                <span className="cal-n num">{Number(d.slice(8))}</span>
                {evs.slice(0, 4).map((e, i) => <Ev key={i} e={e} />)}
                {evs.length > 4 && <span className="muted" style={{ fontSize: 11 }}>+{evs.length - 4} more</span>}
              </div>
            );
          })}
        </div>
      </div>

      <section className="card pad cal-agenda">
        <div className="section-h"><h2>This month</h2><span className="muted num" style={{ fontSize: 12 }}>{monthEvents.length} events</span></div>
        {monthEvents.length === 0 ? <p className="muted">Nothing scheduled this month.</p> : (
          <div style={{ display: "grid", gap: 4 }}>
            {monthEvents.map((e, i) => (
              <div key={i} className="story">
                <span className="num muted" style={{ minWidth: 56, fontSize: 12 }}>{new Date(e.date + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}</span>
                <Ev e={e} />
              </div>
            ))}
          </div>
        )}
      </section>
      {openItem && <ItemDrawer item={openItem} mapping={mapping} schedule={schedule} original={original} conflicts={findConflicts(schedule, draft)} onClose={() => setOpen(null)} />}
    </div>
  );
}
