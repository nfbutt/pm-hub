// Epic links: every open epic as a card, laid out by what waits for what. Drag from one
// epic's handle to another to say the second cannot start until the first is done; the
// link is an ordinary "blocked by", so the Roadmap and the Gantt see it too. Overlaps and
// suggested links can be drawn on the same picture, and the panel says what each line is.
import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { LocalSettings } from "../ai/local";
import { analyze } from "../model/epicmap";
import { canLink, epicGraph, layers, linkEpics, textHints, unlinkEpics, type EpicEdge, type EpicLinkHint } from "../model/epiclinks";
import type { Mapping } from "../model/mapping";
import type { Project } from "../model/normalize";
import type { Op } from "../model/ops";
import { buildPlan } from "../model/plan/cpm";
import { buildSchedule, type Draft } from "../model/schedule";
import type { Editor } from "./useChangeSet";
import { useEpicLinkAI, useOverlapWhy } from "./useEpicAI";
import { useLocalVectors } from "./useLocalModel";
import "./epiclinks.css";

/** Cards are this wide when there is room, and narrow to this before the board scrolls. */
const CARD_MAX = 236;
const CARD_MIN = 184;
const CARD_H = 78;
const COL_GAP = 64;
const ROW_GAP = 22;
const PAD = 20;

type Selection =
  | { kind: "epic"; key: string }
  | { kind: "edge"; from: string; to: string }
  | { kind: "overlap"; a: string; b: string }
  | { kind: "hint"; id: string }
  | null;

const short = (d: string | null) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) : "no date");
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function EpicLinks({ project, mapping, draft, editor, local, aiHref }: {
  project: Project; mapping: Mapping; draft: Draft; editor?: Editor;
  local?: LocalSettings;
  aiHref?: string;
}) {
  const settings = local ?? { enabled: false, base: "", chatModel: "", embedModel: "" };
  const schedule = useMemo(() => buildSchedule(project, mapping, draft), [project, mapping, draft]);
  const plan = useMemo(() => buildPlan(project, mapping, schedule), [project, mapping, schedule]);
  // Overlaps compare by meaning when there is an embedding model, by words otherwise.
  const vectors = useLocalVectors(project, settings);
  const map = useMemo(() => analyze(project, mapping, { openOnly: true, vectors: vectors.vectors.size ? vectors.vectors : undefined }), [project, mapping, vectors.vectors]);
  const graph = useMemo(() => epicGraph(project, mapping, plan, map), [project, mapping, plan, map]);
  const hints = useMemo(() => textHints(project, mapping, plan, graph), [project, mapping, plan, graph]);
  const ai = useEpicLinkAI(project, mapping, plan, graph, settings);
  const why = useOverlapWhy(project, mapping, settings);

  const [selected, setSelected] = useState<Selection>(null);
  const [showOverlaps, setShowOverlaps] = useState(true);
  const [showHints, setShowHints] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<{ from: string; x: number; y: number; over: string | null } | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const [boardW, setBoardW] = useState(900);
  useLayoutEffect(() => {
    const el = board.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBoardW(el.clientWidth));
    ro.observe(el);
    setBoardW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const byKey = useMemo(() => new Map(project.items.map(i => [i.key, i])), [project]);
  const nodeBy = useMemo(() => new Map(graph.nodes.map(n => [n.key, n])), [graph]);
  const cols = useMemo(() => layers(graph), [graph]);
  // The cards narrow to fit the columns on the board, down to a width that still reads.
  const CARD_W = Math.round(Math.max(CARD_MIN, Math.min(CARD_MAX, (boardW - PAD * 2 - (cols.length - 1) * COL_GAP) / Math.max(1, cols.length))));
  const pos = useMemo(() => {
    const out = new Map<string, { x: number; y: number }>();
    cols.forEach((col, c) => col.forEach((key, r) => out.set(key, { x: PAD + c * (CARD_W + COL_GAP), y: PAD + r * (CARD_H + ROW_GAP) })));
    return out;
  }, [cols, CARD_W]);
  const width = PAD * 2 + Math.max(1, cols.length) * (CARD_W + COL_GAP) - COL_GAP;
  const height = PAD * 2 + Math.max(1, ...cols.map(c => c.length)) * (CARD_H + ROW_GAP) - ROW_GAP;

  const suggestions = [...hints, ...ai.items.filter(h => !hints.some(x => x.from === h.from && x.to === h.to))].filter(h => !dismissed.has(h.id));
  const loopKeys = new Set(graph.loops.flat());

  const record = (label: string, ops: Op[]) => {
    if (!editor || !ops.length) return false;
    editor.record(label, ops);
    return true;
  };
  const connect = (from: string, to: string) => {
    const a = byKey.get(from), b = byKey.get(to);
    if (!a || !b) return;
    const ok = canLink(project, plan, from, to);
    if (!ok.ok) { setMsg(ok.why); return; }
    if (record(`“${b.title}” waits for “${a.title}”`, linkEpics(project, plan, a, b))) {
      setMsg(null);
      setSelected({ kind: "edge", from, to });
    }
  };

  // Dragging from a handle draws a line to the pointer; letting go over a card links them.
  const toBoard = (e: { clientX: number; clientY: number }) => {
    const r = board.current!.getBoundingClientRect();
    return { x: e.clientX - r.left + board.current!.scrollLeft, y: e.clientY - r.top + board.current!.scrollTop };
  };
  const epicAt = (e: { clientX: number; clientY: number }) => (document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-epic]") as HTMLElement | null)?.dataset.epic ?? null;
  const startDrag = (key: string, e: RPointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ from: key, ...toBoard(e), over: null });
  };
  const moveDrag = (e: RPointerEvent) => { if (drag) setDrag({ ...drag, ...toBoard(e), over: epicAt(e) }); };
  const endDrag = (e: RPointerEvent) => {
    if (!drag) return;
    const target = epicAt(e);
    const moved = Math.hypot(toBoard(e).x - (pos.get(drag.from)!.x + CARD_W), toBoard(e).y - (pos.get(drag.from)!.y + CARD_H / 2)) > 12;
    setDrag(null);
    if (target && target !== drag.from) connect(drag.from, target);
    // A click on the handle, not a drag: pick the epic that waits next.
    else if (!moved) { setLinkFrom(drag.from); setMsg(`Now click the epic that waits for “${nodeBy.get(drag.from)?.title}”.`); }
  };

  const pathFor = (from: string, to: string) => {
    const a = pos.get(from), b = pos.get(to);
    if (!a || !b) return "";
    const y1 = a.y + CARD_H / 2, y2 = b.y + CARD_H / 2;
    // Two epics in the same column: an arc on their right-hand side.
    if (a.x === b.x) {
      const x = a.x + CARD_W, bulge = 34 + Math.min(60, Math.abs(y2 - y1) / 4);
      return `M${x},${y1} C${x + bulge},${y1} ${x + bulge},${y2} ${x},${y2}`;
    }
    // A link that runs backwards (a suggestion, or a loop): from the left of the one that
    // finishes first into the right of the one that waits, so it never crosses a card.
    if (b.x < a.x) {
      const x1 = a.x, x2 = b.x + CARD_W, k = Math.max(30, (x1 - x2) / 2);
      return `M${x1},${y1} C${x1 - k},${y1} ${x2 + k},${y2} ${x2},${y2}`;
    }
    const x1 = a.x + CARD_W, x2 = b.x;
    const k = Math.max(30, (x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + k},${y1} ${x2 - k},${y2} ${x2},${y2}`;
  };
  const centre = (key: string) => { const p = pos.get(key)!; return { x: p.x + CARD_W / 2, y: p.y + CARD_H / 2 }; };

  const isSel = (s: Selection) => JSON.stringify(s) === JSON.stringify(selected);
  const edgeLabel = (e: EpicEdge) => `${nodeBy.get(e.to)?.title} waits for ${nodeBy.get(e.from)?.title}`;

  if (graph.nodes.length === 0) {
    return <div className="card pad"><p className="muted">There are no open epics yet. Epics are issues with sub-issues, the issue type Epic, or the label you chose in Settings.</p></div>;
  }

  return (
    <div className="elinks">
      <div className="section-h">
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 20 }}>Epic links</h1>
          <p className="muted" style={{ maxWidth: "80ch" }}>
            Which epics wait for which, and which cover the same ground. {editor ? "Drag from an epic’s handle onto the epic that has to wait for it." : "Showing GitHub only: links can’t be changed."}
          </p>
        </div>
        <div className="drow" style={{ alignItems: "center" }}>
          <span className="pill">{graph.edges.length} link{graph.edges.length === 1 ? "" : "s"}</span>
          <span className={`pill ${graph.loops.length ? "bad" : ""}`}>{graph.loops.length ? `${graph.loops.length} loop${graph.loops.length === 1 ? "" : "s"}` : "No loops"}</span>
          <label className="check"><input type="checkbox" checked={showOverlaps} onChange={e => setShowOverlaps(e.target.checked)} /> Overlaps</label>
          <label className="check"><input type="checkbox" checked={showHints} onChange={e => setShowHints(e.target.checked)} /> Suggestions</label>
        </div>
      </div>

      {msg && (
        <div className="callout info" role="status" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>{msg}</span>
          {linkFrom && <button className="btn small" onClick={() => { setLinkFrom(null); setMsg(null); }}>Cancel</button>}
        </div>
      )}

      <div className="elinks-body">
        <div className="card elinks-board" ref={board} onPointerMove={moveDrag} onPointerUp={endDrag}
          onClick={e => { if (e.target === e.currentTarget) setSelected(null); }}>
          <div className="elinks-canvas" style={{ width, height }}>
            <svg className="elinks-lines" width={width} height={height + 100} aria-hidden="true">
              <defs>
                {["link", "critical", "hint"].map(id => (
                  <marker key={id} id={`el-${id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" className={`el-head ${id}`} />
                  </marker>
                ))}
              </defs>
              {showOverlaps && graph.overlaps.slice(0, 12).map(o => {
                const a = centre(o.a), b = centre(o.b);
                const sel: Selection = { kind: "overlap", a: o.a, b: o.b };
                return (
                  <g key={`o:${o.a}|${o.b}`} className={`el-overlap ${isSel(sel) ? "sel" : ""}`} onClick={() => setSelected(sel)}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="hit" />
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="vis" style={{ strokeWidth: 1 + o.score * 5 }} />
                    <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} className="el-olabel">{pct(o.score)} overlap</text>
                  </g>
                );
              })}
              {graph.edges.map(e => {
                const sel: Selection = { kind: "edge", from: e.from, to: e.to };
                const d = pathFor(e.from, e.to);
                return (
                  <g key={`${e.from}>${e.to}`} className={`el-edge ${e.kind} ${e.critical ? "critical" : ""} ${isSel(sel) ? "sel" : ""}`} onClick={() => setSelected(sel)}>
                    <title>{edgeLabel(e)}</title>
                    <path d={d} className="hit" />
                    <path d={d} className="vis" markerEnd={`url(#el-${e.critical ? "critical" : "link"})`} />
                  </g>
                );
              })}
              {showHints && suggestions.map(h => {
                const sel: Selection = { kind: "hint", id: h.id };
                const d = pathFor(h.from, h.to);
                return (
                  <g key={h.id} className={`el-edge hint ${isSel(sel) ? "sel" : ""}`} onClick={() => setSelected(sel)}>
                    <title>Suggested: {h.toTitle} waits for {h.fromTitle}</title>
                    <path d={d} className="hit" />
                    <path d={d} className="vis" markerEnd="url(#el-hint)" />
                  </g>
                );
              })}
              {drag && (() => {
                const a = pos.get(drag.from)!;
                return <path d={`M${a.x + CARD_W},${a.y + CARD_H / 2} L${drag.x},${drag.y}`} className="el-drag" />;
              })()}
            </svg>

            {graph.nodes.map(n => {
              const p = pos.get(n.key)!;
              const sel = selected?.kind === "epic" && selected.key === n.key;
              const done = n.total ? n.done / n.total : 0;
              const target = (drag && drag.over === n.key && drag.from !== n.key) || (linkFrom && linkFrom !== n.key);
              return (
                <div key={n.key} data-epic={n.key} role="button" tabIndex={0}
                  className={`el-card ${sel ? "sel" : ""} ${loopKeys.has(n.key) ? "loop" : ""} ${target ? "target" : ""}`}
                  style={{ left: p.x, top: p.y, width: CARD_W, height: CARD_H }}
                  onClick={() => {
                    if (linkFrom) { const from = linkFrom; setLinkFrom(null); if (from !== n.key) connect(from, n.key); else setMsg(null); return; }
                    setSelected({ kind: "epic", key: n.key });
                  }}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected({ kind: "epic", key: n.key }); } }}>
                  <span className="el-title" title={n.title}>{n.title}</span>
                  <span className="el-meta">
                    <span>{n.release ?? "No release"}</span>
                    <span className="num">{n.done}/{n.total}</span>
                  </span>
                  <span className="progress" role="img" aria-label={`${Math.round(done * 100)}% done`}><span style={{ width: `${done * 100}%` }} /></span>
                  {editor && (
                    <button className="el-handle" aria-label={`Link from ${n.title}: drag to, or click then choose, the epic that waits for it`}
                      title="Drag onto the epic that waits for this one"
                      onPointerDown={e => startDrag(n.key, e)} onClick={e => e.stopPropagation()} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="elinks-panel">
          <Details selected={selected} graph={graph} suggestions={suggestions} project={project} plan={plan} editor={editor}
            nodeBy={nodeBy} byKey={byKey} why={why} aiOn={settings.enabled}
            onConnect={connect} onRecord={record} onSelect={setSelected}
            onDismiss={id => { setDismissed(d => new Set([...d, id])); setSelected(null); }} />

          <section className="card pad el-section">
            <h2>Suggested links</h2>
            {suggestions.length === 0 && <p className="muted">None right now. Links are suggested when an epic or one of its stories says it needs another.</p>}
            <ul className="el-list">
              {suggestions.slice(0, 8).map(h => (
                <li key={h.id}>
                  <button className="linkish" onClick={() => setSelected({ kind: "hint", id: h.id })}>
                    <b>{h.toTitle}</b> waits for <b>{h.fromTitle}</b>
                  </button>
                  <q className="muted">{h.evidence}</q>
                  <span className="pill">{h.source === "model" ? "From the AI" : "From the issues"}</span>
                </li>
              ))}
            </ul>
            <div className="el-ai">
              {ai.status === "off" ? (
                <p className="muted" style={{ fontSize: 12 }}>
                  An AI model can read every epic and its stories and find more. {aiHref ? <a href={aiHref}>Set it up</a> : "Turn it on in the AI page."}
                </p>
              ) : (
                <>
                  <button className="btn" onClick={ai.ask} disabled={ai.status === "working"}>
                    {ai.status === "working" ? "Reading the epics…" : ai.status === "done" ? "Ask the AI again" : "Ask the AI to find dependencies"}
                  </button>
                  {ai.status === "done" && (
                    <p className="muted" style={{ fontSize: 12 }}>
                      {ai.items.length} found{ai.cached ? " (answered before)" : ""}.
                      {ai.dropped > 0 && <> {ai.dropped} left out: {ai.reasons.join("; ")}.</>}
                    </p>
                  )}
                  {ai.error && <p className="bad" style={{ fontSize: 12 }}>{ai.error}</p>}
                </>
              )}
            </div>
          </section>

          <section className="card pad el-section">
            <h2>Overlaps</h2>
            {graph.overlaps.length === 0 && <p className="muted">No two epics cover much of the same ground.</p>}
            <ul className="el-list">
              {graph.overlaps.slice(0, 6).map(o => (
                <li key={`${o.a}|${o.b}`}>
                  <button className="linkish" onClick={() => setSelected({ kind: "overlap", a: o.a, b: o.b })}>
                    <b>{nodeBy.get(o.a)?.title}</b> and <b>{nodeBy.get(o.b)?.title}</b>
                  </button>
                  <span className="el-bar"><span style={{ width: pct(o.score) }} /></span>
                  <span className="muted" style={{ fontSize: 12 }}>{pct(o.score)} · {o.shared.join(", ") || "similar wording"}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** What the selected card, line or suggestion is, and what can be done about it. */
function Details({ selected, graph, suggestions, project, plan, editor, nodeBy, byKey, why, aiOn, onConnect, onRecord, onSelect, onDismiss }: {
  selected: Selection;
  graph: ReturnType<typeof epicGraph>;
  suggestions: EpicLinkHint[];
  project: Project;
  plan: ReturnType<typeof buildPlan>;
  editor?: Editor;
  nodeBy: Map<string, ReturnType<typeof epicGraph>["nodes"][number]>;
  byKey: Map<string, Project["items"][number]>;
  why: ReturnType<typeof useOverlapWhy>;
  aiOn: boolean;
  onConnect: (from: string, to: string) => void;
  onRecord: (label: string, ops: Op[]) => boolean;
  onSelect: (s: Selection) => void;
  onDismiss: (id: string) => void;
}) {
  const [pick, setPick] = useState("");
  if (!selected) {
    return (
      <section className="card pad el-section">
        <h2>How to read this</h2>
        <ul className="el-key">
          <li><span className="sw direct" /> One epic waits for another</li>
          <li><span className="sw stories" /> They wait through their stories</li>
          <li><span className="sw critical" /> On the chain that decides the end date</li>
          <li><span className="sw hint" /> Suggested, not added yet</li>
          <li><span className="sw overlap" /> They cover the same ground</li>
        </ul>
        <p className="muted" style={{ fontSize: 12 }}>Click a card or a line to see what it is.</p>
      </section>
    );
  }
  const title = (k: string) => nodeBy.get(k)?.title ?? byKey.get(k)?.title ?? k;

  if (selected.kind === "epic") {
    const n = nodeBy.get(selected.key);
    if (!n) return null;
    const waitsFor = graph.edges.filter(e => e.to === n.key);
    const neededBy = graph.edges.filter(e => e.from === n.key);
    const others = graph.nodes.filter(o => o.key !== n.key && canLink(project, plan, o.key, n.key).ok);
    return (
      <section className="card pad el-section">
        <h2>{n.title}</h2>
        <p className="muted" style={{ fontSize: 12 }}>{n.release ?? "In no release"} · {short(n.start)} – {short(n.end)} · {n.done} of {n.total} stories done{n.critical ? " · decides the end date" : ""}</p>
        <h3>Waits for</h3>
        {waitsFor.length === 0 ? <p className="muted">Nothing.</p> : (
          <ul className="el-list">{waitsFor.map(e => <EdgeRow key={e.from} e={e} other={e.from} title={title} editor={editor} byKey={byKey} onRecord={onRecord} onSelect={onSelect} />)}</ul>
        )}
        <h3>Needed by</h3>
        {neededBy.length === 0 ? <p className="muted">Nothing waits for it.</p> : (
          <ul className="el-list">{neededBy.map(e => <EdgeRow key={e.to} e={e} other={e.to} title={title} editor={editor} byKey={byKey} onRecord={onRecord} onSelect={onSelect} />)}</ul>
        )}
        {editor && others.length > 0 && (
          <div className="drow" style={{ alignItems: "center" }}>
            <label className="sr" htmlFor="el-add">Make it wait for</label>
            <select id="el-add" className="mini-select" value={pick} onChange={e => setPick(e.target.value)}>
              <option value="">Make it wait for…</option>
              {others.map(o => <option key={o.key} value={o.key}>{o.title}</option>)}
            </select>
            <button className="btn small" disabled={!pick} onClick={() => { onConnect(pick, n.key); setPick(""); }}>Add link</button>
          </div>
        )}
      </section>
    );
  }

  if (selected.kind === "edge") {
    const e = graph.edges.find(x => x.from === selected.from && x.to === selected.to);
    if (!e) return null;
    return (
      <section className="card pad el-section">
        <h2>{title(e.to)} waits for {title(e.from)}</h2>
        <p className="muted">
          {e.kind === "direct" ? "The epics themselves are linked." : `Through ${e.via.length} link${e.via.length === 1 ? "" : "s"} between their stories.`}
          {e.critical ? " This link is on the chain that decides when the plan ends." : ""}
        </p>
        {e.via.length > 0 && (
          <ul className="el-list">{e.via.slice(0, 8).map(([b, w]) => <li key={`${b}>${w}`}><b>{title(w)}</b> waits for <b>{title(b)}</b></li>)}</ul>
        )}
        {editor && e.kind === "direct" && (
          <button className="btn danger" onClick={() => {
            const from = byKey.get(e.from), to = byKey.get(e.to);
            if (from && to && onRecord(`“${to.title}” no longer waits for “${from.title}”`, unlinkEpics(from, to))) onSelect(null);
          }}>Remove this link</button>
        )}
        {e.kind === "stories" && <p className="muted" style={{ fontSize: 12 }}>To take it away, change the stories’ “blocked by” in the Gantt or the item drawer.</p>}
      </section>
    );
  }

  if (selected.kind === "overlap") {
    const o = graph.overlaps.find(x => x.a === selected.a && x.b === selected.b);
    if (!o) return null;
    const id = `${o.a}|${o.b}`;
    const said = why.answers.get(id);
    return (
      <section className="card pad el-section">
        <h2>{title(o.a)} and {title(o.b)}</h2>
        <p>{pct(o.score)} alike. {o.shared.length ? <>They share: {o.shared.join(", ")}.</> : null}</p>
        {said && <p><b>The AI:</b> {said}</p>}
        {said === null && <p className="muted">The AI did not give an answer that could be read.</p>}
        {aiOn && said === undefined && (
          <button className="btn" disabled={why.working === id} onClick={() => void why.explain(o.a, o.b, o.shared)}>
            {why.working === id ? "Asking…" : "Ask the AI what they have in common"}
          </button>
        )}
        <p className="muted" style={{ fontSize: 12 }}>To move stories between them, open them side by side in <b>Compare</b>.</p>
      </section>
    );
  }

  const h = suggestions.find(x => x.id === selected.id);
  if (!h) return null;
  return (
    <section className="card pad el-section">
      <h2>{h.toTitle} waits for {h.fromTitle}?</h2>
      <p className="muted" style={{ fontSize: 12 }}>{h.source === "model" ? "The AI suggested this" : "The issues say so"}, quoting “{h.evidenceIn}”:</p>
      <blockquote className="el-quote">{h.evidence}</blockquote>
      {editor && (
        <div className="drow">
          <button className="btn primary" onClick={() => { if (onRecord(`“${h.toTitle}” waits for “${h.fromTitle}”`, h.ops)) onSelect({ kind: "edge", from: h.from, to: h.to }); }}>Add this link</button>
          <button className="btn" onClick={() => onDismiss(h.id)}>Not a dependency</button>
        </div>
      )}
    </section>
  );
}

function EdgeRow({ e, other, title, editor, byKey, onRecord, onSelect }: {
  e: EpicEdge; other: string; title: (k: string) => string; editor?: Editor;
  byKey: Map<string, Project["items"][number]>;
  onRecord: (label: string, ops: Op[]) => boolean;
  onSelect: (s: Selection) => void;
}) {
  return (
    <li className="el-row">
      <button className="linkish" onClick={() => onSelect({ kind: "edge", from: e.from, to: e.to })}>{title(other)}</button>
      <span className="muted" style={{ fontSize: 12 }}>{e.kind === "direct" ? "linked" : `${e.via.length} story link${e.via.length === 1 ? "" : "s"}`}</span>
      {editor && e.kind === "direct" && (
        <button className="linkbtn" aria-label={`Remove the link with ${title(other)}`} onClick={() => {
          const from = byKey.get(e.from), to = byKey.get(e.to);
          if (from && to) onRecord(`“${to.title}” no longer waits for “${from.title}”`, unlinkEpics(from, to));
        }}>remove</button>
      )}
    </li>
  );
}

