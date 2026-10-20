import { useEffect, useMemo, useRef, useState } from "react";
import { analyze, scoreIfMoved, type EpicMapModel } from "../model/epicmap";
import { categoryName } from "../model/epicmap/categories";
import { moveToParent, newItem } from "../model/edits";
import type { Mapping } from "../model/mapping";
import type { Project } from "../model/normalize";
import type { Op } from "../model/ops";
import { buildSchedule, findConflicts, type Draft } from "../model/schedule";
import { ItemDrawer } from "./ItemDrawer";
import type { Editor } from "./useChangeSet";
import type { DropTarget, MapCanvas } from "./epicmap/canvas";
import "./epicmap/epicmap.css";

export function EpicMap({ project, mapping, draft, editor }: { project: Project; mapping: Mapping; draft: Draft; editor?: Editor }) {
  const [openOnly, setOpenOnly] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [hover, setHover] = useState<{ key: string; target: DropTarget } | null>(null);
  const model = useMemo(() => analyze(project, mapping, { openOnly }), [project, mapping, openOnly]);
  // The score when the tab opened, so a meeting can see how far it moved things.
  const [startScore] = useState(() => model.score);
  const byKey = useMemo(() => new Map(project.items.map(i => [i.key, i])), [project]);
  const title = (k: string | null) => (k ? byKey.get(k)?.title ?? k : "No epic");

  const record = (label: string, ops: Op[]) => { if (editor && ops.length) editor.record(label, ops); };
  const move = (taskKey: string, to: string | null) => {
    const item = byKey.get(taskKey);
    if (item) record(to ? `Moved ${item.title} under ${title(to)}` : `Took ${item.title} out of ${title(item.parentKey)}`, moveToParent(project, item, to));
  };
  const claim = (category: string) => {
    const gap = model.gaps.find(g => g.category === category);
    if (!gap || !editor) return;
    const create = newItem(project, mapping, categoryName(category), { epic: true });
    const key = create[0]?.kind === "create" ? create[0].key : null;
    if (!key) return;
    const moves = gap.taskKeys.flatMap(k => { const it = byKey.get(k); return it ? moveToParent(project, it, key) : []; });
    record(`New epic ${categoryName(category)} with ${moves.length} task${moves.length === 1 ? "" : "s"}`, [...create, ...moves]);
  };

  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<MapCanvas | null>(null);
  const latest = useRef({ move, claim, model });
  latest.current = { move, claim, model };
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let dead = false;
    import("./epicmap/canvas").then(({ mountCanvas }) => {
      if (dead || !box.current) return;
      canvas.current = mountCanvas(box.current, {
        open: setOpen,
        hover: (key, target) => setHover(target === undefined ? null : { key, target }),
        drop: (key, target) => latest.current.move(key, target),
        claim: c => latest.current.claim(c),
      });
      canvas.current.update(latest.current.model, !editor);
    }, () => setFailed(true));
    return () => { dead = true; canvas.current?.destroy(); canvas.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { canvas.current?.update(model, !editor); }, [model, editor]);

  const schedule = useMemo(() => buildSchedule(project, mapping, draft), [project, mapping, draft]);
  const original = useMemo(() => buildSchedule(editor?.base ?? project, mapping), [editor?.base, project, mapping]);
  const openItem = open ? schedule.byKey.get(open) : null;
  const preview = hover ? scoreIfMoved(model, hover.key, hover.target ?? null) : null;
  const delta = preview !== null && model.score !== null ? preview - model.score : null;
  const sessionDelta = model.score !== null && startScore !== null ? model.score - startScore : 0;
  const epics = [...model.epics].sort((a, b) => (a.health ?? 101) - (b.health ?? 101));

  return (
    <div className="emap">
      <div className="section-h">
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800 }}>Epic Map</h1>
          <p className="muted" style={{ maxWidth: "80ch" }}>Each bubble is an epic and each dot a task, coloured by the kind of work it is. Related work drifts together, red bands show epics that overlap, dashed bubbles are kinds of work no epic owns. Drag a dot into another epic to move it; the score shows whether that makes the epics more independent.</p>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label className="check-row"><input id="em-open" type="checkbox" checked={openOnly} onChange={() => setOpenOnly(!openOnly)} /> Open work only</label>
          <button className="btn" onClick={() => canvas.current?.fit()}>Fit</button>
          <button className="btn" onClick={() => canvas.current?.relayout()}>Shuffle layout</button>
        </div>
      </div>

      <div className="emap-body">
        <div className="card emap-canvas-wrap">
          <div ref={box} className="emap-canvas" role="img" aria-label="Map of epics and their tasks" />
          {failed && <p className="callout bad emap-float">The map couldn't load. Reload the page to try again.</p>}
          {!editor && <span className="pill emap-float">Read-only: turn off “GitHub only” to move tasks</span>}
          {hover && (
            <div className={`emap-preview ${delta === null ? "" : delta > 0 ? "up" : delta < 0 ? "down" : ""}`} aria-live="polite">
              Drop into <b>{title(hover.target ?? null)}</b>{delta !== null && <>: score {delta > 0 ? "+" : ""}{delta}</>}
            </div>
          )}
        </div>

        <aside className="emap-panel">
          <section className="card pad emap-score">
            <div className="muted">Structure score</div>
            <div className="emap-score-v">{model.score ?? "—"}<span>/100</span></div>
            <div className="emap-meter"><i style={{ width: `${model.score ?? 0}%` }} /></div>
            <p className="muted">How much related work sits inside the same epic. {sessionDelta !== 0 && <b className={sessionDelta > 0 ? "good" : "bad"}>{sessionDelta > 0 ? "+" : ""}{sessionDelta} since you opened the map</b>}</p>
          </section>

          {model.moves.length > 0 && (
            <section className="card pad">
              <h3>Tasks that may be in the wrong place</h3>
              <ul className="emap-list">
                {model.moves.slice(0, 6).map(mv => (
                  <li key={mv.taskKey}>
                    <button className="emap-link" onClick={() => canvas.current?.focus(mv.taskKey)}>{title(mv.taskKey)}</button>
                    <span className="muted"> {title(mv.from)} → {title(mv.to)}</span>
                    {editor && <button className="btn small" onClick={() => move(mv.taskKey, mv.to)}>Move{mv.gain > 0 ? ` (+${mv.gain})` : ""}</button>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {model.gaps.length > 0 && (
            <section className="card pad">
              <h3>Work with no epic of its own</h3>
              <ul className="emap-list">
                {model.gaps.map(g => (
                  <li key={g.category}>
                    <span className="emap-swatch" style={{ background: `var(--cat-${g.category})` }} /> <b>{categoryName(g.category)}</b>
                    <span className="muted"> {g.taskKeys.length} tasks spread across other epics</span>
                    {editor && <button className="btn small" onClick={() => claim(g.category)}>Create epic</button>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {model.overlaps.length > 0 && (
            <section className="card pad">
              <h3>Overlapping epics</h3>
              <ul className="emap-list">
                {model.overlaps.slice(0, 5).map(o => (
                  <li key={o.a + o.b}>
                    <b>{Math.round(o.score * 100)}%</b> {title(o.a)} ↔ {title(o.b)}
                    {o.shared.length > 0 && <div className="muted">shared: {o.shared.join(", ")}</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card pad">
            <h3>Epic health</h3>
            <ul className="emap-list">
              {epics.map(e => (
                <li key={e.key}>
                  <button className="emap-link" onClick={() => canvas.current?.focus(e.key)}>{e.title}</button>
                  <span className={`pill ${e.health === null ? "" : e.health >= 70 ? "good" : e.health >= 55 ? "warn" : "bad"}`}>{e.health ?? "—"}</span>
                  <div className="muted"><span className="emap-swatch" style={{ background: `var(--cat-${e.category})` }} /> {categoryName(e.category)} · {e.taskKeys.length} tasks{e.priority ? ` · ${e.priority}` : ""}{e.release ? ` · ${e.release}` : ""}</div>
                  {e.flags.length > 0 && <div className="muted emap-flags">{e.flags.join(" · ")}</div>}
                </li>
              ))}
            </ul>
          </section>

          <section className="card pad">
            <h3>Kinds of work</h3>
            <ul className="emap-legend">
              {model.categories.map(c => (
                <li key={c.id}><span className="emap-swatch" style={{ background: `var(--cat-${c.id})` }} /> {categoryName(c.id)} <span className="muted">{c.tasks} tasks · {c.epics} epics</span></li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {openItem && <ItemDrawer item={openItem} project={project} mapping={mapping} schedule={schedule} original={original} draft={draft}
        conflicts={findConflicts(schedule, draft)} editor={editor} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}

export type { EpicMapModel };
