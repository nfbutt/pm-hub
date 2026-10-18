import { Fragment, useMemo, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import {
  epicOptions, laneOptions, milestoneOptions, moveToParent, newItem, peopleOptions, setAssignees, setLane, setMilestone, setOption,
  setState, setTitle, shiftDates,
} from "../model/edits";
import { isEpic, laneOf, priorityOf, statusOf, type Mapping } from "../model/mapping";
import type { Item, Project } from "../model/normalize";
import { datesOp, type Op } from "../model/ops";
import { buildSchedule, findConflicts, type Draft } from "../model/schedule";
import { PickButton } from "../ui/Picker";
import { ItemDrawer } from "./ItemDrawer";
import type { Editor } from "./useChangeSet";

type Col = "title" | "lane" | "status" | "priority" | "release" | "start" | "end" | "owners";
const COLS: { id: Col; label: string }[] = [
  { id: "title", label: "Title" }, { id: "lane", label: "Lane" }, { id: "status", label: "Status" }, { id: "priority", label: "Priority" },
  { id: "release", label: "Release" }, { id: "start", label: "Start" }, { id: "end", label: "End" }, { id: "owners", label: "Owners" },
];

interface Props {
  project: Project; mapping: Mapping; draft: Draft; editor?: Editor;
  selected: Set<string>; onSelect: (keys: Set<string>) => void;
}

export function Plan({ project, mapping, draft, editor, selected, onSelect }: Props) {
  const schedule = useMemo(() => buildSchedule(project, mapping, draft), [project, mapping, draft]);
  const original = useMemo(() => buildSchedule(editor?.base ?? project, mapping), [editor?.base, project, mapping]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showClosed, setShowClosed] = useState(false);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ parent: string | null; text: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const statusField = mapping.statusField ? project.fields.find(f => f.name === mapping.statusField && f.kind === "single") : undefined;
  const prioField = mapping.priority.kind === "field" ? project.fields.find(f => f.name === (mapping.priority as { field: string }).field && f.kind === "single") : undefined;
  const lanes = laneOptions(project, mapping);
  const visible = (i: Item) => (showClosed || i.state === "open") && (!filter || i.title.toLowerCase().includes(filter.toLowerCase()));

  // Epics with their children; anything else open and not under an epic goes in "Other items".
  const rows = useMemo(() => {
    const out: { item: Item; depth: number; group: string }[] = [];
    const epics = project.items.filter(i => isEpic(i, mapping)).sort((a, b) =>
      (laneOf(a, mapping) ?? "~").localeCompare(laneOf(b, mapping) ?? "~") || (schedule.bars.get(a.key)?.start ?? "9999").localeCompare(schedule.bars.get(b.key)?.start ?? "9999"));
    for (const e of epics) {
      const kids = (schedule.children.get(e.key) ?? []).filter(visible);
      if (!visible(e) && !kids.length) continue;
      out.push({ item: e, depth: 0, group: "epics" });
      if (expanded.has(e.key) || (filter && kids.length)) for (const k of kids) out.push({ item: k, depth: 1, group: "epics" });
    }
    for (const i of project.items) if (!isEpic(i, mapping) && !i.parentKey && visible(i)) out.push({ item: i, depth: 0, group: "other" });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, mapping, schedule, expanded, showClosed, filter]);

  const rec = (label: string, ops: Op[]) => { if (editor && ops.length) editor.record(label, ops); };
  const targets = (key: string) => (selected.has(key) && selected.size > 1 ? [...selected] : [key]).map(k => schedule.byKey.get(k)).filter((i): i is Item => !!i);

  // ----- applying a value to a column (used by cells, paste and the bulk bar) -----
  function applyCol(col: Col, items: Item[], value: string): Op[] {
    const v = value.trim();
    return items.flatMap(item => {
      switch (col) {
        case "title": return items.length === 1 ? setTitle(item, v) : [];
        case "lane": { const lane = lanes.find(l => l.toLowerCase() === v.toLowerCase()); return lane ? setLane(project, mapping, item, lane) : []; }
        case "status": case "priority": {
          const f = col === "status" ? statusField : prioField;
          if (!f || f.kind !== "single") return [];
          const opt = f.options.find(o => o.name.toLowerCase() === v.toLowerCase());
          return v === "" ? setOption(project, item, f.name, null) : opt ? setOption(project, item, f.name, opt.name) : [];
        }
        case "release": {
          if (v === "") return setMilestone(item, null);
          const ms = milestoneOptions(project, item.repo).find(m => m.title.toLowerCase() === v.toLowerCase());
          return ms ? setMilestone(item, ms) : [];
        }
        case "start": case "end": {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return [];
          const bar = schedule.bars.get(item.key);
          let start = col === "start" ? v : bar?.start ?? v, end = col === "end" ? v : bar?.end ?? v;
          if (start > end) { if (col === "start") end = start; else start = end; }
          return [datesOp(item, mapping, start, end)];
        }
        case "owners": return setAssignees(item, v.split(/[,\s]+/).filter(Boolean));
      }
    });
  }
  const setCell = (col: Col, key: string, value: string) => {
    const items = targets(key);
    rec(`${COLS.find(c => c.id === col)!.label} → ${value || "empty"}${items.length > 1 ? ` for ${items.length} items` : ""}`, applyCol(col, items, value));
  };

  const cellValue = (col: Col, i: Item): string => {
    const bar = schedule.bars.get(i.key);
    switch (col) {
      case "title": return i.title;
      case "lane": return laneOf(i, mapping) ?? "";
      case "status": return statusOf(i, mapping) ?? "";
      case "priority": return priorityOf(i, mapping)?.name ?? "";
      case "release": return i.milestone?.title ?? "";
      case "start": return bar?.start ?? "";
      case "end": return bar?.end ?? "";
      case "owners": return i.assignees.join(", ");
    }
  };

  function onCellKey(e: KeyboardEvent, col: Col, i: Item) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && !(e.target as HTMLElement).matches("input,select")) {
      e.preventDefault();
      void navigator.clipboard?.writeText(cellValue(col, i)).then(() => setNote(`Copied “${cellValue(col, i)}”`), () => setNote("Copy failed. Select the text instead."));
    }
  }
  function onCellPaste(e: ClipboardEvent, col: Col, i: Item) {
    if ((e.target as HTMLElement).matches("input:not([type=checkbox]),select")) return;
    e.preventDefault();
    setCell(col, i.key, e.clipboardData.getData("text/plain"));
  }

  function toggle(key: string, shift: boolean) {
    const n = new Set(selected);
    if (shift && anchor) {
      const keys = rows.map(r => r.item.key), a = keys.indexOf(anchor), b = keys.indexOf(key);
      for (const k of keys.slice(Math.min(a, b), Math.max(a, b) + 1)) n.add(k);
    } else if (n.has(key)) n.delete(key); else n.add(key);
    setAnchor(key); onSelect(n);
  }

  const selItems = [...selected].map(k => schedule.byKey.get(k)).filter((i): i is Item => !!i);
  const openItem = open ? schedule.byKey.get(open) : null;
  const allEpicKeys = project.items.filter(i => isEpic(i, mapping)).map(i => i.key);

  const select = (col: Col, i: Item, options: string[]) => (
    <select className="cell-select" aria-label={`${COLS.find(c => c.id === col)!.label} for ${i.title}`} value={cellValue(col, i)} disabled={!editor}
      onChange={e => setCell(col, i.key, e.target.value)}>
      <option value="">—</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="toolbar" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input id="plan-filter" className="input" style={{ maxWidth: 260, fontFamily: "var(--f-body)" }} placeholder="Filter by title…" value={filter} onChange={e => setFilter(e.target.value)} />
        <button className="btn" onClick={() => setExpanded(expanded.size ? new Set() : new Set(allEpicKeys))}>{expanded.size ? "Collapse all" : "Expand all"}</button>
        <label className="check-row"><input id="plan-closed" type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} /> Show closed</label>
        {editor && <button className="btn" onClick={() => setAdding({ parent: null, text: "" })}>+ New epic</button>}
        <span style={{ flex: 1 }} />
        {note && <span className="pill good" onAnimationEnd={() => setNote(null)}>{note}</span>}
        <span className="muted" style={{ fontSize: 12 }}>{editor ? "Click a cell to edit · Ctrl+C / Ctrl+V on a cell · Shift-click to select a range" : "Read-only: turn off “GitHub only” to edit"}</span>
      </div>

      {selected.size > 0 && editor && (
        <div className="bulkbar card">
          <b>{selected.size} selected</b>
          {statusField?.kind === "single" && <select className="cell-select" aria-label="Set status" value="" onChange={e => { const v = e.target.value; e.target.value = ""; rec(`Status → ${v} for ${selItems.length}`, applyCol("status", selItems, v)); }}>
            <option value="">Set status…</option>{statusField.options.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}</select>}
          {prioField?.kind === "single" && <select className="cell-select" aria-label="Set priority" value="" onChange={e => { const v = e.target.value; rec(`Priority → ${v} for ${selItems.length}`, applyCol("priority", selItems, v)); }}>
            <option value="">Set priority…</option>{prioField.options.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}</select>}
          {lanes.length > 0 && <select className="cell-select" aria-label="Set lane" value="" onChange={e => { const v = e.target.value; rec(`Lane → ${v} for ${selItems.length}`, applyCol("lane", selItems, v)); }}>
            <option value="">Set lane…</option>{lanes.map(l => <option key={l} value={l}>{l}</option>)}</select>}
          <button className="btn" onClick={() => rec(`Shifted ${selItems.length} items a week earlier`, shiftDates(project, mapping, [...selected], -7))}>−1 week</button>
          <button className="btn" onClick={() => rec(`Shifted ${selItems.length} items a week later`, shiftDates(project, mapping, [...selected], 7))}>+1 week</button>
          <div style={{ minWidth: 200 }}>
            <PickButton id="bulk-parent" label="Move to epic" value="" options={epicOptions(project, mapping).map(e => ({ value: e.key, label: e.title }))}
              onPick={v => rec(`Moved ${selItems.length} items under ${schedule.byKey.get(v)?.title}`, selItems.flatMap(i => moveToParent(project, i, v)))} />
          </div>
          <button className="btn" onClick={() => rec(`Closed ${selItems.length} items`, selItems.flatMap(i => setState(i, "closed", "COMPLETED")))}>Close as done</button>
          <button className="btn ghost" onClick={() => onSelect(new Set())}>Clear selection</button>
        </div>
      )}

      {adding && editor && (
        <form className="card pad" style={{ display: "flex", gap: 8 }} onSubmit={e => {
          e.preventDefault(); if (!adding.text.trim()) return;
          rec(`Added ${adding.parent ? "story" : "epic"} “${adding.text.trim()}”`, newItem(project, mapping, adding.text, { parentKey: adding.parent, epic: !adding.parent }));
          setAdding({ ...adding, text: "" });
        }}>
          <input id="plan-new" className="input" style={{ fontFamily: "var(--f-body)" }} autoFocus placeholder={adding.parent ? `New story under ${schedule.byKey.get(adding.parent)?.title}` : "New epic title"}
            value={adding.text} onChange={e => setAdding({ ...adding, text: e.target.value })} onKeyDown={e => { if (e.key === "Escape") setAdding(null); }} />
          <button className="btn primary" type="submit" disabled={!adding.text.trim()}>Add</button>
          <button className="btn ghost" type="button" onClick={() => setAdding(null)}>Done</button>
        </form>
      )}

      <div className="card tablewrap plan-wrap">
        <table className="t plan">
          <thead><tr>
            <th style={{ width: 32 }}><input type="checkbox" aria-label="Select all shown" checked={rows.length > 0 && rows.every(r => selected.has(r.item.key))}
              onChange={e => onSelect(e.target.checked ? new Set(rows.map(r => r.item.key)) : new Set())} /></th>
            {COLS.map(c => <th key={c.id}>{c.label}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r, idx) => {
              const i = r.item;
              const moved = (() => { const a = schedule.bars.get(i.key), b = original.bars.get(i.key); return !!a && (!b || a.start !== b.start || a.end !== b.end); })();
              const kids = schedule.children.get(i.key)?.length ?? 0;
              const firstOther = r.group === "other" && rows[idx - 1]?.group !== "other";
              return (
                <Fragment key={i.key}>
                  {firstOther && <tr className="plan-group"><td colSpan={COLS.length + 1}>Other items (not under an epic)</td></tr>}
                  <tr className={`${r.depth ? "kid" : "epicrow"} ${selected.has(i.key) ? "sel" : ""} ${i.state !== "open" ? "closedrow" : ""}`}>
                    <td><input type="checkbox" aria-label={`Select ${i.title}`} checked={selected.has(i.key)} onChange={() => {}} onClick={e => toggle(i.key, e.shiftKey)} /></td>
                    <td className="titlecell" tabIndex={0} onKeyDown={e => onCellKey(e, "title", i)} onPaste={e => onCellPaste(e, "title", i)}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", paddingLeft: r.depth * 18 }}>
                        {r.depth === 0 && kids > 0 ? (
                          <button className="twist" aria-expanded={expanded.has(i.key)} aria-label="Show sub-issues"
                            onClick={() => { const n = new Set(expanded); if (n.has(i.key)) n.delete(i.key); else n.add(i.key); setExpanded(n); }}>{expanded.has(i.key) ? "▾" : "▸"}</button>
                        ) : <span style={{ width: 12 }} />}
                        {editor ? <TitleCell item={i} onCommit={t => rec(`Renamed to “${t}”`, setTitle(i, t))} /> : <span>{i.title}</span>}
                        <button className="linkbtn" onClick={() => setOpen(i.key)} title="Open details">details</button>
                        {r.depth === 0 && isEpic(i, mapping) && editor && <button className="linkbtn" onClick={() => setAdding({ parent: i.key, text: "" })}>+ story</button>}
                        {i.key.startsWith("new:") && <span className="pill accent">new</span>}
                      </div>
                    </td>
                    <td tabIndex={0} onKeyDown={e => onCellKey(e, "lane", i)} onPaste={e => onCellPaste(e, "lane", i)}>{lanes.length ? select("lane", i, lanes) : <span className="muted">—</span>}</td>
                    <td tabIndex={0} onKeyDown={e => onCellKey(e, "status", i)} onPaste={e => onCellPaste(e, "status", i)}>{statusField?.kind === "single" ? select("status", i, statusField.options.map(o => o.name)) : "—"}</td>
                    <td tabIndex={0} onKeyDown={e => onCellKey(e, "priority", i)} onPaste={e => onCellPaste(e, "priority", i)}>{prioField?.kind === "single" ? select("priority", i, prioField.options.map(o => o.name)) : "—"}</td>
                    <td tabIndex={0} onKeyDown={e => onCellKey(e, "release", i)} onPaste={e => onCellPaste(e, "release", i)}>{i.kind === "draft" ? "—" : select("release", i, milestoneOptions(project, i.repo).map(m => m.title))}</td>
                    {(["start", "end"] as const).map(col => (
                      <td key={col} tabIndex={0} className={moved ? "movedcell" : ""} onKeyDown={e => onCellKey(e, col, i)} onPaste={e => onCellPaste(e, col, i)}>
                        <input type="date" className="cell-date" aria-label={`${col} for ${i.title}`} value={cellValue(col, i)} disabled={!editor}
                          onChange={e => e.target.value && setCell(col, i.key, e.target.value)} />
                      </td>
                    ))}
                    <td tabIndex={0} onKeyDown={e => onCellKey(e, "owners", i)} onPaste={e => onCellPaste(e, "owners", i)}>
                      {editor ? (
                        <PickButton id={`own-${idx}`} label="" multi value={i.assignees.join(", ")} selected={i.assignees} options={peopleOptions(project).map(l => ({ value: l, label: l }))}
                          onPick={v => rec(`${i.title}: owners updated`, setAssignees(i, i.assignees.includes(v) ? i.assignees.filter(a => a !== v) : [...i.assignees, v]))} />
                      ) : (i.assignees.join(", ") || <span className="muted">—</span>)}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p className="muted" style={{ padding: 16 }}>Nothing matches.</p>}
      </div>
      {openItem && <ItemDrawer item={openItem} project={project} mapping={mapping} schedule={schedule} original={original} draft={draft}
        conflicts={findConflicts(schedule, draft)} editor={editor} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}

function TitleCell({ item, onCommit }: { item: Item; onCommit: (t: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  if (text === null) return <button className="cell-title" onClick={() => setText(item.title)} title="Click to rename">{item.title}</button>;
  return (
    <input className="rename" autoFocus value={text} aria-label={`Rename ${item.title}`} onChange={e => setText(e.target.value)}
      onBlur={() => { if (text.trim() && text.trim() !== item.title) onCommit(text.trim()); setText(null); }}
      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setText(null); }} />
  );
}
