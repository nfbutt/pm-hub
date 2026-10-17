import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { axis, DAY_PX, SNAP_DAYS, xOf, type Zoom } from "../model/axis";
import { addDays, priorityOf, type Mapping } from "../model/mapping";
import type { Item, Project } from "../model/normalize";
import { rowsToCsv, rowsToMarkdown } from "../model/export";
import { buildSchedule, daysBetween, findConflicts, ganttRows, releaseColumns, timeWindow, type Draft, type Row } from "../model/schedule";
import type { Prefs } from "../store/cache";
import { CopyBox } from "../ui/CopyBox";
import { Modal } from "../ui/Drawer";
import { ItemDrawer } from "./ItemDrawer";
import "./gantt.css";

const LANE_COLORS = ["var(--lane-1)", "var(--lane-2)", "var(--lane-3)", "var(--lane-4)"];
const today = () => new Date().toISOString().slice(0, 10);
const short = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

interface Props {
  project: Project; mapping: Mapping;
  draft: Draft; setDraft: (u: (d: Draft) => Draft) => void; resetDraft: () => void; changed: number;
  prefs: Prefs; setPrefs: (p: Prefs) => void;
}

export function Gantt({ project, mapping, draft, setDraft, resetDraft, changed, prefs, setPrefs }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [live, setLive] = useState<{ key: string; start: string; end: string } | null>(null);
  const drag = useRef<{ key: string; mode: "move" | "l" | "r"; x0: number; start: string; end: string; moved: boolean } | null>(null);
  const [rowDrag, setRowDrag] = useState<{ key: string; lane: string } | null>(null);
  const [dropAt, setDropAt] = useState<{ key: string; above: boolean } | null>(null);

  const zoom: Zoom = prefs.zoom;
  const dayPx = DAY_PX[zoom];
  const effDraft = useMemo(() => live ? { ...draft, bars: { ...draft.bars, [live.key]: { start: live.start, end: live.end } } } : draft, [draft, live]);
  const schedule = useMemo(() => buildSchedule(project, mapping, effDraft), [project, mapping, effDraft]);
  const original = useMemo(() => buildSchedule(project, mapping), [project, mapping]);
  const conflicts = useMemo(() => findConflicts(schedule, effDraft), [schedule, effDraft]);
  const groups = useMemo(() => ganttRows(project, mapping, schedule, effDraft, { includeClosed: prefs.includeClosed, expanded }),
    [project, mapping, schedule, effDraft, prefs.includeClosed, expanded]);
  const releases = useMemo(() => releaseColumns(project, mapping, schedule).filter(r => r.due), [project, mapping, schedule]);
  const visibleBars = groups.flatMap(g => g.rows.map(r => r.bar).filter((b): b is NonNullable<typeof b> => !!b));
  // Keep the window stable while dragging so the chart doesn't jump.
  const winRef = useRef<{ start: string; end: string } | null>(null);
  const win = useMemo(() => {
    if (drag.current && winRef.current) return winRef.current;
    const w = timeWindow(visibleBars, today(), releases.map(r => r.due!));
    winRef.current = w; return w;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleBars.map(b => b.start + b.end).join(), releases.length]);
  const ax = useMemo(() => axis(win.start, win.end, prefs.fyStartMonth), [win, prefs.fyStartMonth]);
  // Release labels sit to the left of their line; skip a label when the previous one would overlap it.
  const labelled = useMemo(() => {
    const out = new Set<string>(); let lastX = -Infinity;
    for (const r of releases) { const x = xOf(win.start, r.due!, dayPx); if (x - lastX >= 118) { out.add(r.id); lastX = x; } }
    return out;
  }, [releases, win.start, dayPx]);
  const conflictKeys = new Set(conflicts.map(c => c.key));
  const parkedItems = draft.parked.map(k => schedule.byKey.get(k)).filter((i): i is Item => !!i);
  const undated = groups.flatMap(g => g.undated);
  const epicCount = groups.reduce((n, g) => n + g.rows.filter(r => r.depth === 0).length, 0);
  const undatedCount = undated.length;
  const mostlyUndated = epicCount > 0 && undatedCount / epicCount >= 0.4;
  const dateFieldNames = [mapping.startField, mapping.endField].filter(Boolean).join(" and ");
  const todayX = xOf(win.start, today(), dayPx);
  const hasKids = (i: Item) => (schedule.children.get(i.key)?.length ?? 0) > 0;

  // ----- bar drag -----
  function onBarDown(e: RPointerEvent, row: Row) {
    if (!row.bar || e.button !== 0) return;
    const mode = (e.target as HTMLElement).dataset.h === "l" ? "l" : (e.target as HTMLElement).dataset.h === "r" ? "r" : "move";
    drag.current = { key: row.item.key, mode, x0: e.clientX, start: row.bar.start, end: row.bar.end, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onBarMove(e: RPointerEvent) {
    const d = drag.current; if (!d) return;
    const snap = SNAP_DAYS[zoom];
    const delta = Math.round((e.clientX - d.x0) / dayPx / snap) * snap;
    if (Math.abs(e.clientX - d.x0) > 3) d.moved = true;
    if (!d.moved) return;
    let start = d.start, end = d.end;
    if (d.mode === "move") { start = addDays(d.start, delta); end = addDays(d.end, delta); }
    if (d.mode === "l") { start = addDays(d.start, delta); if (start > end) start = end; }
    if (d.mode === "r") { end = addDays(d.end, delta); if (end < start) end = start; }
    setLive({ key: d.key, start, end });
  }
  function onBarUp() {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.moved && live) setDraft(x => ({ ...x, bars: { ...x.bars, [live.key]: { start: live.start, end: live.end } } }));
    else setOpen(d.key);
    setLive(null);
  }

  // ----- reorder -----
  const laneOrder = (lane: string) => groups.find(g => g.lane === lane)!.rows.filter(r => r.depth === 0).map(r => r.item.key);
  function moveRow(key: string, dir: -1 | 1) {
    const g = groups.find(g => g.rows.some(r => r.item.key === key && r.depth === 0)); if (!g) return;
    const order = laneOrder(g.lane), i = order.indexOf(key), j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    setDraft(d => ({ ...d, order: { ...d.order, [g.lane]: order } }));
  }
  function dropRow(targetKey: string, lane: string, above: boolean) {
    if (!rowDrag || rowDrag.lane !== lane || rowDrag.key === targetKey) return;
    const order = laneOrder(lane).filter(k => k !== rowDrag.key);
    order.splice(order.indexOf(targetKey) + (above ? 0 : 1), 0, rowDrag.key);
    setDraft(d => ({ ...d, order: { ...d.order, [lane]: order } }));
  }

  const openItem = open ? schedule.byKey.get(open) : null;
  const width = ax.days * dayPx;

  return (
    <div className="gantt-view">
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Zoom">
          {(["week", "month", "quarter"] as Zoom[]).map(z => (
            <button key={z} className={z === zoom ? "on" : ""} aria-pressed={z === zoom} onClick={() => setPrefs({ ...prefs, zoom: z })}>{z[0]!.toUpperCase() + z.slice(1)}</button>
          ))}
        </div>
        <label className="check"><input id="g-closed" type="checkbox" checked={prefs.includeClosed} onChange={e => setPrefs({ ...prefs, includeClosed: e.target.checked })} /> Show closed</label>
        <button className="btn" onClick={() => setExpanded(expanded.size ? new Set() : new Set(groups.flatMap(g => g.rows.filter(r => r.depth === 0 && hasKids(r.item)).map(r => r.item.key))))}>
          {expanded.size ? "Collapse all" : "Expand all"}
        </button>
        <span className="spacer" />
        {changed > 0 && <span className="pill warn">Draft: {changed} change{changed > 1 ? "s" : ""}, not on GitHub</span>}
        {conflicts.length > 0 ? <span className="pill bad">{conflicts.length} conflict{conflicts.length > 1 ? "s" : ""}</span> : <span className="pill good">No conflicts</span>}
        <button className="btn" disabled={!changed} onClick={() => setConfirmReset(true)}>Reset draft</button>
        <button className="btn primary" onClick={() => setExporting(true)}>Export</button>
      </div>

      {confirmReset && (
        <div className="callout warn" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>Discard every draft change and go back to the dates on GitHub?</span>
          <button className="btn" onClick={() => { resetDraft(); setConfirmReset(false); }}>Discard draft</button>
          <button className="btn" onClick={() => setConfirmReset(false)}>Keep it</button>
        </div>
      )}

      {mostlyUndated && (
        <div className="callout info">
          <b>{undatedCount} of {epicCount} epics have no dates</b>, so they're listed under the chart instead of on it.
          Set {dateFieldNames ? <>the <b>{dateFieldNames}</b> fields</> : "start and end dates"} on GitHub, give their sub-issues dates,
          or use <b>Place</b> to try a window in your draft.
        </div>
      )}

      {groups.length === 0 ? (
        <div className="card pad"><p>No epics found. Check <a href="#settings" onClick={e => { e.preventDefault(); location.hash = location.hash.replace(/\/[a-z]+$/, "/settings"); }}>how epics are detected</a>.</p></div>
      ) : (
        <div className="board card">
          <div className="gscroll">
            <div className="gantt" style={{ width: `calc(var(--lw) + ${width}px)` }} onPointerMove={onBarMove} onPointerUp={onBarUp}
              onPointerCancel={() => { drag.current = null; setLive(null); }}>
              <div className="bg" style={{ width }}>
                {ax.months.map((m, i) => i % 2 ? <div key={m.start} className="band" style={{ left: xOf(win.start, m.start, dayPx), width: m.days * dayPx }} /> : null)}
                {zoom !== "quarter" && ax.weeks.map(w => <div key={w.start} className="wline" style={{ left: xOf(win.start, w.start, dayPx) }} />)}
                {releases.map(r => <div key={r.id} className="rline" style={{ left: xOf(win.start, r.due!, dayPx) + dayPx }} />)}
                {todayX >= 0 && todayX <= width && <div className="today" style={{ left: todayX }} />}
              </div>

              <div className="grow ghead">
                <div className="gl"><span className="eyebrow">Epic</span></div>
                <div className="gt" style={{ width }}>
                  <div className="hrow">{ax.quarters.map(s => <div key={s.start} className="hseg strong" style={{ left: xOf(win.start, s.start, dayPx), width: s.days * dayPx }}>{s.label}</div>)}</div>
                  <div className="hrow">{ax.months.map(s => <div key={s.start} className="hseg" style={{ left: xOf(win.start, s.start, dayPx), width: s.days * dayPx }}>{s.days * dayPx > 46 ? s.label : s.label.slice(0, 3)}</div>)}</div>
                  <div className="hrow">{releases.map(r => (
                    <div key={r.id} className={`rmark ${labelled.has(r.id) ? "" : "bare"}`} style={{ left: xOf(win.start, r.due!, dayPx) + dayPx }} title={`${r.title} due ${short(r.due!)} · ${r.done}/${r.items.length} done`}>
                      <span>{labelled.has(r.id) ? r.title : ""}</span>
                    </div>
                  ))}</div>
                  {zoom !== "quarter" && <div className="hrow">{ax.weeks.map(s => <div key={s.start} className="hseg week" style={{ left: xOf(win.start, s.start, dayPx), width: s.days * dayPx }}>{zoom === "week" || s.days * dayPx > 30 ? s.label : ""}</div>)}</div>}
                </div>
              </div>

              {groups.map((g, gi) => ({ g, gi, shown: g.rows.filter(r => r.depth > 0 || r.bar) })).filter(x => x.shown.length > 0).map(({ g, gi, shown }) => (
                <div key={g.lane}>
                  <div className="grow glane">
                    <div className="gl"><span className="dot" style={{ background: LANE_COLORS[gi % LANE_COLORS.length] }} /><b>{g.lane}</b>
                      <span className="muted num">{shown.filter(r => r.depth === 0).length}{g.undated.length > 0 && ` + ${g.undated.length} undated`}</span></div>
                    <div className="gt" style={{ width }} />
                  </div>
                  {shown.map(r => {
                    const prio = priorityOf(r.item, mapping);
                    const color = prio ? `var(--p-${Math.min(prio.rank, 3)})` : LANE_COLORS[gi % LANE_COLORS.length];
                    const pct = r.item.subIssues ? (100 * r.item.subIssues.completed) / r.item.subIssues.total : r.item.state === "open" ? 0 : 100;
                    const isDrop = dropAt?.key === r.item.key;
                    return (
                      <div key={r.item.key} className={`grow erow ${r.depth ? "child" : ""} ${isDrop ? (dropAt!.above ? "drop-above" : "drop-below") : ""}`}
                        onDragOver={e => { if (!rowDrag || r.depth || rowDrag.lane !== g.lane) return; e.preventDefault(); const b = e.currentTarget.getBoundingClientRect(); setDropAt({ key: r.item.key, above: e.clientY < b.top + b.height / 2 }); }}
                        onDrop={e => { e.preventDefault(); if (dropAt) dropRow(r.item.key, g.lane, dropAt.above); setRowDrag(null); setDropAt(null); }}>
                        <div className="gl">
                          {r.depth === 0 ? (
                            <button className="grip" draggable aria-label={`Reorder ${r.item.title}`} title="Drag to reorder"
                              onDragStart={e => { setRowDrag({ key: r.item.key, lane: g.lane }); e.dataTransfer.effectAllowed = "move"; }}
                              onDragEnd={() => { setRowDrag(null); setDropAt(null); }}>⋮⋮</button>
                          ) : <span />}
                          {hasKids(r.item) ? (
                            <button className="twist" aria-expanded={expanded.has(r.item.key)} aria-label="Show sub-issues"
                              onClick={() => { const n = new Set(expanded); n.has(r.item.key) ? n.delete(r.item.key) : n.add(r.item.key); setExpanded(n); }}>
                              {expanded.has(r.item.key) ? "▾" : "▸"}
                            </button>
                          ) : <span />}
                          <button className="ename" onClick={() => setOpen(r.item.key)} title={r.item.title}>
                            <span className="etitle">{r.item.title}</span>
                            {r.item.number && <span className="enum">#{r.item.number}</span>}
                          </button>
                        </div>
                        <div className="gt" style={{ width }}>
                          {r.moved && r.original && (
                            <div className="ghostbar" style={{ left: xOf(win.start, r.original.start, dayPx), width: (daysBetween(r.original.start, r.original.end) + 1) * dayPx }} />
                          )}
                          {r.bar && (r.bar.deadlineOnly && r.bar.start === r.bar.end ? (
                            <div className="diamond" style={{ left: xOf(win.start, r.bar.end, dayPx), ["--bar" as string]: color }} title={`${r.item.title} · due ${short(r.bar.end)}`}
                              onClick={() => setOpen(r.item.key)} />
                          ) : (
                            <div className={`bar ${conflictKeys.has(r.item.key) ? "conflict" : ""} ${r.moved ? "moved" : ""} ${r.item.state !== "open" ? "closed" : ""}`}
                              style={{ left: xOf(win.start, r.bar.start, dayPx) + 1, width: Math.max(dayPx, (daysBetween(r.bar.start, r.bar.end) + 1) * dayPx - 2), ["--bar" as string]: color }}
                              title={`${r.item.title} · ${short(r.bar.start)} – ${short(r.bar.end)}${r.item.subIssues ? ` · ${r.item.subIssues.completed}/${r.item.subIssues.total} done` : ""}`}
                              onPointerDown={e => onBarDown(e, r)}>
                              <span className="fill" style={{ width: `${pct}%` }} />
                              <span className="h l" data-h="l" />
                              <span className="blabel">{r.item.title}</span>
                              <span className="h r" data-h="r" />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {(undated.length > 0 || parkedItems.length > 0) && (
            <div className="tray">
              {undated.length > 0 && <>
                <span className="eyebrow">No dates ({undated.length})</span>
                <div className="chips">{undated.map(i => (
                  <span key={i.key} className="chip"><button className="linkish" onClick={() => setOpen(i.key)}>{i.title}</button>
                    <button onClick={() => setDraft(d => ({ ...d, bars: { ...d.bars, [i.key]: { start: today(), end: addDays(today(), 27) } } }))}>Place</button></span>
                ))}</div>
              </>}
              {parkedItems.length > 0 && <>
                <span className="eyebrow">Parked ({parkedItems.length})</span>
                <div className="chips">{parkedItems.map(i => (
                  <span key={i.key} className="chip"><button className="linkish" onClick={() => setOpen(i.key)}>{i.title}</button>
                    <button onClick={() => setDraft(d => ({ ...d, parked: d.parked.filter(k => k !== i.key) }))}>Put back</button></span>
                ))}</div>
              </>}
            </div>
          )}
        </div>
      )}

      {openItem && (
        <ItemDrawer item={openItem} mapping={mapping} schedule={schedule} original={original} draft={draft} conflicts={conflicts}
          onClose={() => setOpen(null)} onDraft={setDraft} onMove={dir => moveRow(openItem.key, dir)} />
      )}
      {exporting && (
        <Modal title="Export this arrangement" onClose={() => setExporting(false)}>
          <p className="muted">Includes your draft changes. Nothing is sent to GitHub.</p>
          <CopyBox id="x-csv" label="CSV" text={rowsToCsv(groups)} />
          <CopyBox id="x-md" label="Markdown" text={rowsToMarkdown(groups)} />
        </Modal>
      )}
    </div>
  );
}
