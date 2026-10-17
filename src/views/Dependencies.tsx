import { graphlib, layout } from "@dagrejs/dagre";
import { useMemo, useState } from "react";
import { buildGraph, criticalPath, findCycles, type Graph, type GraphOptions } from "../model/deps";
import type { Mapping } from "../model/mapping";
import type { Project } from "../model/normalize";
import { buildSchedule, findConflicts, type Draft } from "../model/schedule";
import { ItemDrawer } from "./ItemDrawer";

const today = () => new Date().toISOString().slice(0, 10);
const NODE_W = 232, NODE_H = 48;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

interface Laid { nodes: { key: string; x: number; y: number }[]; edges: { from: string; to: string; kind: string; points: { x: number; y: number }[] }[]; width: number; height: number }

export function layoutGraph(g: Graph): Laid {
  const dg = new graphlib.Graph({ multigraph: true });
  dg.setGraph({ rankdir: "LR", nodesep: 18, ranksep: 64, marginx: 16, marginy: 16 });
  dg.setDefaultEdgeLabel(() => ({}));
  for (const n of g.nodes) dg.setNode(n.key, { width: NODE_W, height: NODE_H });
  g.edges.forEach((e, i) => dg.setEdge(e.from, e.to, {}, `${e.kind}-${i}`));
  layout(dg);
  const meta = dg.graph() as { width?: number; height?: number };
  return {
    nodes: g.nodes.map(n => { const v = dg.node(n.key) as { x: number; y: number }; return { key: n.key, x: v.x, y: v.y }; }),
    edges: g.edges.map((e, i) => ({ ...e, points: ((dg.edge({ v: e.from, w: e.to, name: `${e.kind}-${i}` }) as { points?: { x: number; y: number }[] })?.points ?? []) })),
    width: meta.width ?? 0, height: meta.height ?? 0,
  };
}

export function Dependencies({ project, mapping, draft }: { project: Project; mapping: Mapping; draft: Draft }) {
  const [opts, setOpts] = useState<GraphOptions>({ parentEdges: false, openOnly: true, epicsOnly: false });
  const [fit, setFit] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const schedule = useMemo(() => buildSchedule(project, mapping, draft), [project, mapping, draft]);
  const original = useMemo(() => buildSchedule(project, mapping), [project, mapping]);
  const graph = useMemo(() => buildGraph(project, mapping, opts), [project, mapping, opts]);
  const tooBig = graph.nodes.length > 400;
  const laid = useMemo(() => (tooBig ? null : layoutGraph(graph)), [graph, tooBig]);
  const cycles = useMemo(() => findCycles(graph), [graph]);
  const cp = useMemo(() => criticalPath(graph, schedule, today()), [graph, schedule]);
  const inCycle = new Set(cycles.flat());
  const pathEnd = cp.path.map(k => schedule.bars.get(k)?.end).filter((d): d is string => !!d).sort().pop() ?? null;
  const onPath = new Set(cp.path);
  const pathEdge = new Set(cp.path.slice(1).map((k, i) => `${cp.path[i]}>${k}`));
  const blocksCount = graph.edges.filter(e => e.kind === "blocks").length;
  const allBlocks = project.items.reduce((n, i) => n + i.blockedBy.length, 0);
  const openItem = open ? schedule.byKey.get(open) : null;
  const toggle = (k: keyof GraphOptions) => setOpts({ ...opts, [k]: !opts[k] });

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="section-h">
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800 }}>Dependencies</h1>
          <p className="muted" style={{ maxWidth: "80ch" }}>Arrows point from the work that has to finish first to the work it unblocks, using GitHub's "blocked by" links. The highlighted chain is the longest run of open work: a delay anywhere on it delays the end.</p>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label className="check-row"><input id="d-parent" type="checkbox" checked={opts.parentEdges} onChange={() => toggle("parentEdges")} /> Parent/child links</label>
          <label className="check-row"><input id="d-open" type="checkbox" checked={opts.openOnly} onChange={() => toggle("openOnly")} /> Open only</label>
          <label className="check-row"><input id="d-epics" type="checkbox" checked={opts.epicsOnly} onChange={() => toggle("epicsOnly")} /> Epics only</label>
          <button className="btn" onClick={() => setFit(!fit)}>{fit ? "Actual size" : "Fit to width"}</button>
        </div>
      </div>

      <div className="stats">
        <div className="card stat"><span className="v">{graph.nodes.length}</span><span className="l">Items with links</span></div>
        <div className="card stat"><span className="v">{blocksCount}</span><span className="l">“Blocked by” links shown</span></div>
        <div className="card stat"><span className="v" style={{ fontSize: 20 }}>{cp.path.length ? (pathEnd ? new Date(pathEnd + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "No dates") : "—"}</span><span className="l">Critical path ends ({cp.path.length} items in the chain)</span></div>
        <div className="card stat"><span className="v" style={{ color: cycles.length ? "var(--bad)" : undefined }}>{cycles.length}</span><span className="l">Cycles</span></div>
      </div>

      {cycles.length > 0 && (
        <div className="callout bad" role="alert">
          {cycles.length === 1 ? "These items block each other in a loop, so none of them can finish: " : `${cycles.length} loops where items block each other: `}
          {cycles.map(c => c.map(k => schedule.byKey.get(k)?.title ?? k).join(" → ")).join("; ")}
        </div>
      )}

      {graph.nodes.length === 0 ? (
        <div className="card pad" style={{ display: "grid", gap: 8 }}>
          <p><b>Nothing to draw with these settings.</b> {allBlocks === 0
            ? "No issue in this project uses GitHub's “blocked by” links yet."
            : "Try turning off “Open only” or “Epics only”."}</p>
          {allBlocks === 0 && <p className="muted">Turn on <b>Parent/child links</b> to see how epics break down, or mark dependencies on GitHub from an issue's sidebar (Relationships → Mark as blocked by).</p>}
        </div>
      ) : tooBig ? (
        <div className="card pad"><p>{graph.nodes.length} items is too many to lay out legibly. Turn on “Epics only” or “Open only”.</p></div>
      ) : laid && (
        <div className="card deps-wrap">
          <svg className="deps" width={fit ? "100%" : laid.width} viewBox={`0 0 ${laid.width} ${laid.height}`} style={fit ? { maxHeight: "70vh" } : undefined} role="img" aria-label="Dependency graph">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="arrowhead" /></marker>
              <marker id="arrow-cp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="arrowhead cp" /></marker>
            </defs>
            {laid.edges.map((e, i) => {
              const crit = e.kind === "blocks" && pathEdge.has(`${e.from}>${e.to}`);
              const loop = e.kind === "blocks" && inCycle.has(e.from) && inCycle.has(e.to);
              const d = e.points.map((p, k) => `${k ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
              return <path key={i} d={d} className={`edge ${e.kind} ${crit ? "cp" : ""} ${loop ? "loop" : ""}`} markerEnd={e.kind === "blocks" ? `url(#${crit ? "arrow-cp" : "arrow"})` : undefined} />;
            })}
            {laid.nodes.map(n => {
              const it = schedule.byKey.get(n.key)!;
              const cls = ["node", it.state !== "open" ? "closed" : "", onPath.has(n.key) ? "cp" : "", inCycle.has(n.key) ? "loop" : ""].filter(Boolean).join(" ");
              return (
                <g key={n.key} className={cls} transform={`translate(${n.x - NODE_W / 2},${n.y - NODE_H / 2})`} onClick={() => setOpen(n.key)} role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === "Enter") setOpen(n.key); }}>
                  <title>{it.title}</title>
                  <rect width={NODE_W} height={NODE_H} rx={8} />
                  <text x={10} y={19} className="ntitle">{clip(it.title, 32)}</text>
                  <text x={10} y={36} className="nmeta">{it.number ? `#${it.number}` : it.kind} · {it.state === "open" ? (schedule.bars.get(it.key)?.end ? `due ${schedule.bars.get(it.key)!.end}` : "no dates") : "done"}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
      {openItem && <ItemDrawer item={openItem} mapping={mapping} schedule={schedule} original={original} conflicts={findConflicts(schedule, draft)} onClose={() => setOpen(null)} />}
    </div>
  );
}
