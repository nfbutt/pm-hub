// The roadmap: every epic on a timeline, with the dependencies between them, the chain
// that decides when the plan ends, and the releases the work has to fit into. This is the
// epic-level view: the Gantt shows the work, this shows the shape of the plan.
import { useMemo, useState } from "react";
import { axis, xOf, DAY_PX, type Zoom } from "../model/axis";
import type { Mapping } from "../model/mapping";
import type { Project } from "../model/normalize";
import type { Op } from "../model/ops";
import { buildPlan, type PlanEpic } from "../model/plan/cpm";
import { buildSchedule, daysBetween, type Draft } from "../model/schedule";
import type { Editor } from "./useChangeSet";
import { PlanCheck } from "./plan/PlanCheck";
import { usePlanSuggestions } from "./usePlanSuggestions";
import type { LocalSettings } from "../ai/local";

const ROW_H = 32;
const HEAD_H = 54;
const LEFT_W = 260;

const short = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

export function Roadmap({ project, mapping, draft, editor, local, zoom, today }: {
  project: Project; mapping: Mapping; draft: Draft; editor?: Editor;
  /** The model on this computer, if there is one. */
  local?: LocalSettings;
  zoom: Zoom;
  today: string;
}) {
  const schedule = useMemo(() => buildSchedule(project, mapping, draft), [project, mapping, draft]);
  const plan = useMemo(() => buildPlan(project, mapping, schedule), [project, mapping, schedule]);
  const settings = local ?? { enabled: false, base: "", chatModel: "", embedModel: "" };
  const suggestions = usePlanSuggestions(project, mapping, plan, settings);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  /** The epics a problem points at, so the chart can show them. */
  const [focus, setFocus] = useState<Set<string>>(new Set());
  const dayPx = DAY_PX[zoom];

  // The rows: epics with dates, ordered by the release they belong to and then by start.
  const rows = useMemo(() => {
    const dated = [...plan.epics.values()].filter(e => e.start && e.end);
    const undated = [...plan.epics.values()].filter(e => !e.start);
    dated.sort((a, b) => {
      const ad = a.due ?? "9999-99-99", bd = b.due ?? "9999-99-99";
      if (ad !== bd) return ad.localeCompare(bd);
      return a.start!.localeCompare(b.start!);
    });
    return { dated, undated };
  }, [plan]);

  // The window the chart covers.
  const win = useMemo(() => {
    let lo = today, hi = today;
    for (const e of rows.dated) {
      if (e.start! < lo) lo = e.start!;
      if (e.end! > hi) hi = e.end!;
      if (e.due) { if (e.due < lo) lo = e.due; if (e.due > hi) hi = e.due; }
    }
    const pad = zoom === "week" ? 7 : zoom === "month" ? 14 : 45;
    const start = new Date(lo + "T00:00:00Z"); start.setUTCDate(start.getUTCDate() - pad);
    const end = new Date(hi + "T00:00:00Z"); end.setUTCDate(end.getUTCDate() + pad);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }, [rows, today, zoom]);

  const width = Math.max(320, daysBetween(win.start, win.end) * dayPx);
  const ax = axis(win.start, win.end, 1);
  const index = useMemo(() => new Map(rows.dated.map((e, i) => [e.key, i])), [rows]);
  const releases = useMemo(() => {
    const seen = new Map<string, { title: string; due: string }>();
    for (const e of rows.dated) if (e.due) seen.set(`${e.release}|${e.due}`, { title: e.release ?? "Release", due: e.due });
    return [...seen.values()].sort((a, b) => a.due.localeCompare(b.due));
  }, [rows]);

  const arrowFor = (from: PlanEpic, to: PlanEpic) => {
    const y1 = HEAD_H + (index.get(from.key) ?? 0) * ROW_H + ROW_H / 2;
    const y2 = HEAD_H + (index.get(to.key) ?? 0) * ROW_H + ROW_H / 2;
    const x1 = xOf(win.start, from.end!, dayPx) + dayPx;
    const x2 = xOf(win.start, to.start!, dayPx);
    return { x1, y1, x2, y2 };
  };

  const breaks = plan.problems.filter(p => p.severity === 3);
  const record = (label: string, ops: Op[]) => { if (editor && ops.length) editor.record(label, ops); };

  return (
    <div className="emap">
      <div className="section-h">
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800 }}>Roadmap</h1>
          <p className="muted" style={{ maxWidth: "80ch" }}>
            Every epic on one timeline, with what blocks what. The red chain is the work that decides when the plan ends;
            everything else can slip. Dotted lines are links that start too early.
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <span className={`pill ${breaks.length ? "bad" : "good"}`}>{breaks.length ? `${breaks.length} thing${breaks.length === 1 ? "" : "s"} break the plan` : "The plan works"}</span>
          <span className="pill">{plan.critical.length} on the critical chain</span>
          {plan.endsOn && <span className="pill" title="When the plan would end if every dependency were respected">Plan ends {short(plan.endsOn)}</span>}
        </div>
      </div>

      <div className="emap-body">
        <div className="card road-board">
          {rows.dated.length === 0 ? (
            <p className="muted" style={{ padding: 16 }}>No epics with dates yet. Give them start and end dates, or use “Place” on the Gantt.</p>
          ) : (
            <div className="road-scroll">
              <div className="road-grid" style={{ width: LEFT_W + width }}>
                <div className="road-head" style={{ height: HEAD_H }}>
                  <div className="rl" style={{ width: LEFT_W }}><span className="eyebrow">Epic</span></div>
                  <div className="rt" style={{ width }}>
                    <div className="hrow">{ax.quarters.map(s => <div key={s.start} className="hseg strong" style={{ left: xOf(win.start, s.start, dayPx), width: s.days * dayPx }}>{s.label}</div>)}</div>
                    <div className="hrow">{ax.months.map(s => <div key={s.start} className="hseg" style={{ left: xOf(win.start, s.start, dayPx), width: s.days * dayPx }}>{s.days * dayPx > 46 ? s.label : s.label.slice(0, 3)}</div>)}</div>
                    <div className="hrow">{releases.map(r => (
                      <div key={r.due} className="rmark" style={{ left: xOf(win.start, r.due, dayPx) + dayPx }} title={`${r.title} due ${short(r.due)}`}>
                        <span>{r.title}</span>
                      </div>
                    ))}</div>
                  </div>
                </div>

                <svg className="road-arrows" width={LEFT_W + width} height={HEAD_H + rows.dated.length * ROW_H + 8} aria-hidden="true">
                  <defs>
                    <marker id="road-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                      <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
                    </marker>
                  </defs>
                  {plan.links.map(l => {
                    const from = plan.epics.get(l.from), to = plan.epics.get(l.to);
                    if (!from?.start || !to?.start) return null;
                    const { x1, y1, x2, y2 } = arrowFor(from, to);
                    const early = from.end! > to.start!;
                    return (
                      <path key={`${l.from}-${l.to}`} d={`M${x1},${y1} C${x1 + 26},${y1} ${x2 - 26},${y2} ${x2},${y2}`}
                        className={`road-link ${l.critical ? "critical" : ""} ${early ? "early" : ""}`}
                        markerEnd="url(#road-arrow)" />
                    );
                  })}
                </svg>

                {rows.dated.map((e) => {
                  const slack = e.slack;
                  const left = xOf(win.start, e.start!, dayPx);
                  const barWidth = Math.max(dayPx, (daysBetween(e.start!, e.end!) + 1) * dayPx - 2);
                  return (
                    <div key={e.key} className={`road-row ${e.critical ? "critical" : ""} ${focus.has(e.key) ? "focus" : ""}`} style={{ height: ROW_H }}>
                      <div className="rl" style={{ width: LEFT_W }}>
                        <span className="rname">{e.title}</span>
                        {e.release && <span className="muted rrel">{e.release}</span>}
                      </div>
                      <div className="rt" style={{ width }}>
                        <div className="rbar" style={{ left, width: barWidth }} title={`${e.title} · ${short(e.start!)} – ${short(e.end!)}${slack !== null ? ` · ${slack} day${slack === 1 ? "" : "s"} of slack` : ""}`}>
                          <span className="fill" style={{ width: `${e.done ?? 0}%` }} />
                        </div>
                        {slack !== null && slack <= 0 && <span className="rslack critical" style={{ left: left + barWidth + 5 }}>critical</span>}
                        {slack !== null && slack > 0 && slack <= 3 && <span className="rslack near" style={{ left: left + barWidth + 5 }}>{slack}d slack</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <aside className="emap-panel">
          <PlanCheck plan={plan} links={suggestions.links} releases={suggestions.releases} status={suggestions.status}
            dropped={suggestions.dropped} dismissed={dismissed}
            onAccept={(ops, label) => record(label, ops)}
            onDismiss={id => setDismissed(d => new Set([...d, id]))}
            onFocus={keys => setFocus(new Set(keys))}
            readOnly={!editor} />
        </aside>
      </div>
    </div>
  );
}
