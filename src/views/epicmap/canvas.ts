// The Epic Map's drawing surface: epics as bubbles holding task dots, laid out by force so
// related work drifts together. Imperative Cytoscape code, loaded only when the tab opens.
// It never edits anything: drops are reported back and the view records them as changes.
import cytoscape, { type Core, type ElementDefinition, type NodeSingular, type Position } from "cytoscape";
import fcose from "cytoscape-fcose";
import { categoryName } from "../../model/epicmap/categories";
import type { EpicMapModel } from "../../model/epicmap";

cytoscape.use(fcose);

/** Where a task was dropped: an epic key, null for "no epic", undefined for nowhere new. */
export type DropTarget = string | null | undefined;

export interface CanvasEvents {
  open: (key: string) => void;
  hover: (taskKey: string, target: DropTarget) => void;
  drop: (taskKey: string, target: string | null) => void;
  claim: (category: string) => void;
}

export interface MapCanvas {
  update: (model: EpicMapModel, readOnly: boolean) => void;
  fit: () => void;
  relayout: () => void;
  focus: (key: string) => void;
  destroy: () => void;
}

const TRAY = "tray";
const epicId = (k: string) => `e:${k}`;
const taskId = (k: string) => `t:${k}`;
const keyOf = (id: string) => id.slice(2);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function palette(el: HTMLElement) {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    cat: (id: string) => v(`--cat-${id}`, v("--cat-other", "#8a94a3")),
    fg: v("--fg", "#16202c"), muted: v("--muted", "#5b6878"), surface: v("--surface", "#fff"),
    accent: v("--accent", "#1b4f8a"), bad: v("--bad", "#c0362c"), line: v("--line", "#d7dde5"),
    font: v("--f-body", "system-ui"),
  };
}

function elements(model: EpicMapModel): ElementDefinition[] {
  const out: ElementDefinition[] = [];
  for (const e of model.epics) {
    const health = e.health === null ? "no tasks" : `health ${e.health}`;
    out.push({ group: "nodes", data: { id: epicId(e.key), kind: "epic", cat: e.category, label: `${clip(e.title, 40)}\n${health} · ${e.taskKeys.length} task${e.taskKeys.length === 1 ? "" : "s"}` } });
  }
  out.push({ group: "nodes", data: { id: TRAY, kind: "tray", cat: "other", label: "No epic\ndrop here to take a task out" } });
  for (const t of model.tasks) {
    out.push({
      group: "nodes", classes: [t.state !== "open" ? "closed" : "", t.misfit ? "misfit" : ""].filter(Boolean).join(" "),
      data: { id: taskId(t.key), parent: t.epicKey ? epicId(t.epicKey) : TRAY, kind: "task", cat: t.category, label: clip(t.title, 34) },
    });
  }
  model.gaps.forEach(g => {
    const id = `g:${g.category}`;
    out.push({ group: "nodes", data: { id, kind: "ghost", cat: g.category, label: `No ${categoryName(g.category)} epic\n${g.taskKeys.length} tasks · click to create` } });
    for (const k of g.taskKeys.slice(0, 6)) out.push({ group: "edges", classes: "gapline", data: { id: `gl:${g.category}:${k}`, source: id, target: taskId(k) } });
  });
  for (const o of model.overlaps.slice(0, 10)) {
    if (o.score < 0.15) break;
    out.push({ group: "edges", classes: "overlap", data: { id: `o:${o.a}|${o.b}`, source: epicId(o.a), target: epicId(o.b), w: o.score, label: `${Math.round(o.score * 100)}% overlap` } });
  }
  // Similarity between tasks: invisible, but it shapes the layout and lights up on hover.
  for (const e of model.edges) {
    if (e.w < 0.25) continue;
    const a = model.tasks[e.a]!.key, b = model.tasks[e.b]!.key;
    out.push({ group: "edges", classes: "sim", data: { id: `s:${a}|${b}`, source: taskId(a), target: taskId(b), w: e.w } });
  }
  return out;
}

export function mountCanvas(container: HTMLElement, on: CanvasEvents): MapCanvas {
  let colors = palette(container);
  let readOnly = true;
  const cy: Core = cytoscape({ container, wheelSensitivity: 0.3, minZoom: 0.15, maxZoom: 3, boxSelectionEnabled: false, style: [] });

  const restyle = () => {
    colors = palette(container);
    const c = colors;
    cy.style([
      { selector: "node", style: { "font-family": c.font, color: c.fg, "text-wrap": "wrap" } },
      { selector: 'node[kind="task"]', style: {
        width: 18, height: 18, "background-color": (n: NodeSingular) => c.cat(n.data("cat")), "border-width": 2, "border-color": c.surface,
        label: "data(label)", "font-size": 9, "text-valign": "bottom", "text-margin-y": 3, "min-zoomed-font-size": 11, "text-max-width": "120px",
        "transition-property": "opacity, border-color, width, height", "transition-duration": 200,
      } },
      { selector: 'node[kind="task"].closed', style: { opacity: 0.4 } },
      { selector: 'node[kind="task"].misfit', style: { "border-color": c.bad, "border-width": 3, "border-style": "dashed", width: 22, height: 22 } },
      { selector: 'node[kind="task"]:grabbed', style: { width: 26, height: 26, "border-color": c.accent, "border-width": 3, "z-index": 999 } },
      { selector: 'node[kind="epic"], node[kind="tray"], node[kind="ghost"]', style: {
        shape: "round-rectangle", "corner-radius": "28px", padding: "22px", label: "data(label)", "text-valign": "top", "text-halign": "center",
        "font-size": 17, "font-weight": 700, "text-margin-y": -8, "text-max-width": "240px", "line-height": 1.35,
      } },
      { selector: 'node[kind="epic"]', style: {
        "background-color": (n: NodeSingular) => c.cat(n.data("cat")), "background-opacity": 0.1,
        "border-color": (n: NodeSingular) => c.cat(n.data("cat")), "border-width": 2, "border-opacity": 0.55,
        "min-width": "90px", "min-height": "60px",
      } },
      { selector: 'node[kind="tray"]', style: { "background-color": c.muted, "background-opacity": 0.04, "border-color": c.muted, "border-width": 1.5, "border-style": "dashed", color: c.muted, "font-weight": 600, "min-width": "160px", "min-height": "70px" } },
      { selector: 'node[kind="ghost"]', style: {
        "background-color": (n: NodeSingular) => c.cat(n.data("cat")), "background-opacity": 0.04, "border-style": "dashed", "border-width": 2,
        "border-color": (n: NodeSingular) => c.cat(n.data("cat")), width: 190, height: 96, "text-valign": "center", color: c.muted, "font-weight": 600, "font-size": 14,
      } },
      { selector: ".drop-target", style: { "border-color": c.accent, "border-width": 4, "border-opacity": 1, "background-opacity": 0.2, "border-style": "solid" } },
      { selector: "edge.overlap", style: {
        "curve-style": "bezier", width: "mapData(w, 0.15, 0.5, 2, 14)", "line-color": c.bad, opacity: 0.28,
        label: "data(label)", "font-size": 10, "font-family": c.font, color: c.bad, "text-background-color": c.surface, "text-background-opacity": 0.85, "text-background-padding": "2px",
      } },
      { selector: "edge.gapline", style: { "curve-style": "bezier", width: 1, "line-color": c.muted, "line-style": "dashed", opacity: 0.35 } },
      { selector: "edge.sim", style: { "curve-style": "haystack", width: "mapData(w, 0.25, 0.8, 1, 4)", "line-color": c.accent, opacity: 0, events: "no" } },
      { selector: "edge.sim.lit", style: { opacity: 0.55 } },
      { selector: "node.dim", style: { opacity: 0.25 } },
      { selector: "node.focus", style: { "border-color": c.accent, "border-width": 4, "border-opacity": 1 } },
    ]);
  };
  restyle();
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", restyle);
  const themeWatch = new MutationObserver(restyle);
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  let layout: cytoscape.Layouts | null = null;
  const run = (randomize: boolean, fit: boolean) => {
    layout?.stop();
    layout = cy.elements().not("edge.gapline").layout({
      name: "fcose", quality: "default", randomize, animate: !randomize, animationDuration: 550, fit, padding: 40,
      nodeDimensionsIncludeLabels: true, packComponents: true, tile: true,
      nodeRepulsion: () => 6500, nodeSeparation: 80, gravity: 0.35, gravityCompound: 1.4, gravityRangeCompound: 1.2, nestingFactor: 0.12,
      idealEdgeLength: (e: cytoscape.EdgeSingular) => (e.hasClass("overlap") ? 320 - 300 * e.data("w") : e.hasClass("sim") ? 40 : 160),
      edgeElasticity: (e: cytoscape.EdgeSingular) => (e.hasClass("sim") ? 0.05 + 0.3 * e.data("w") : 0.45),
    } as cytoscape.LayoutOptions);
    layout.run();
  };

  // Drag a task onto another epic (or the tray). Boxes are measured at grab time: the task's own
  // epic grows as it is dragged, and other epics don't move while you drag.
  let drag: { key: string; from: string; start: Position; boxes: { id: string; x1: number; y1: number; x2: number; y2: number }[]; target: string | null } | null = null;
  const hit = (p: Position) => {
    if (!drag) return null;
    const inside = drag.boxes.filter(b => p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2);
    inside.sort((a, b) => (a.x2 - a.x1) * (a.y2 - a.y1) - (b.x2 - b.x1) * (b.y2 - b.y1));
    return inside[0]?.id ?? null;
  };
  const toTarget = (id: string | null): DropTarget => (id === null ? undefined : id === TRAY ? null : keyOf(id));
  cy.on("grab", 'node[kind="task"]', ev => {
    const n = ev.target as NodeSingular;
    const from = n.parent().first().id() || TRAY;
    const boxes = cy.nodes('node[kind="epic"], node[kind="tray"]').map(b => ({ id: b.id(), ...b.boundingBox({ includeLabels: false }) }));
    drag = { key: keyOf(n.id()), from, start: { ...n.position() }, boxes, target: from };
  });
  cy.on("drag", 'node[kind="task"]', ev => {
    if (!drag) return;
    const id = hit((ev.target as NodeSingular).position());
    const target = id && id !== drag.from ? id : null;
    if (target === drag.target) return;
    cy.$(".drop-target").removeClass("drop-target");
    if (target) cy.getElementById(target).addClass("drop-target");
    drag.target = target;
    on.hover(drag.key, toTarget(target));
  });
  cy.on("free", 'node[kind="task"]', ev => {
    if (!drag) return;
    const d = drag; drag = null;
    cy.$(".drop-target").removeClass("drop-target");
    on.hover(d.key, undefined);
    const n = ev.target as NodeSingular;
    if (d.target && d.target !== d.from) on.drop(d.key, d.target === TRAY ? null : keyOf(d.target));
    else n.animate({ position: d.start }, { duration: 250, easing: "ease-out-cubic" });
  });

  // Hover a task to see what it is similar to.
  cy.on("mouseover", 'node[kind="task"]', ev => {
    if (drag) return;
    const n = ev.target as NodeSingular;
    const sims = n.connectedEdges(".sim");
    sims.addClass("lit");
    cy.nodes('node[kind="task"]').not(n).not(sims.connectedNodes()).addClass("dim");
  });
  cy.on("mouseout", 'node[kind="task"]', () => { cy.$(".lit").removeClass("lit"); cy.$(".dim").removeClass("dim"); });

  cy.on("tap", 'node[kind="task"], node[kind="epic"]', ev => on.open(keyOf((ev.target as NodeSingular).id())));
  cy.on("tap", 'node[kind="ghost"]', ev => on.claim((ev.target as NodeSingular).id().slice(2)));

  let first = true;
  return {
    update(model, ro) {
      readOnly = ro;
      const next = elements(model);
      const ids = new Set(next.map(e => e.data.id!));
      let structural = false;
      cy.batch(() => {
        cy.elements().filter(e => !ids.has(e.id())).forEach(e => { structural = true; cy.remove(e); });
        // Parents first, so children can be placed into them.
        const ordered = [...next.filter(e => e.group === "nodes" && !e.data.parent), ...next.filter(e => e.group === "nodes" && e.data.parent), ...next.filter(e => e.group === "edges")];
        for (const def of ordered) {
          const cur = cy.getElementById(def.data.id!);
          if (cur.empty()) {
            structural = true;
            const near = def.data.parent ? cy.getElementById(def.data.parent as string) : null;
            cy.add({ ...def, position: near && near.nonempty() ? { ...near.position() } : undefined });
            continue;
          }
          const { parent, ...data } = def.data;
          cur.data(data);
          cur.classes(def.classes ?? "");
          if (def.group === "nodes" && (cur.parent().first().id() || undefined) !== parent) {
            structural = true;
            (cur as NodeSingular).move({ parent: (parent as string | undefined) ?? null });
          }
        }
      });
      cy.nodes('node[kind="task"]').forEach(n => { if (readOnly) n.ungrabify(); else n.grabify(); });
      if (first) { first = false; run(true, true); }
      else if (structural) run(false, false);
    },
    fit: () => cy.animate({ fit: { eles: cy.elements(), padding: 40 } }, { duration: 350 }),
    relayout: () => run(true, true),
    focus(key) {
      const n = cy.getElementById(epicId(key)).nonempty() ? cy.getElementById(epicId(key)) : cy.getElementById(taskId(key));
      if (n.empty()) return;
      cy.$(".focus").removeClass("focus");
      n.addClass("focus");
      cy.animate({ fit: { eles: n.union(n.children()), padding: 120 } }, { duration: 450, easing: "ease-in-out-cubic" });
      setTimeout(() => n.removeClass("focus"), 1800);
    },
    destroy() {
      layout?.stop();
      media.removeEventListener("change", restyle);
      themeWatch.disconnect();
      cy.destroy();
    },
  };
}
