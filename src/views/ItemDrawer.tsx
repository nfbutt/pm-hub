import { useEffect, useState } from "react";
import {
  addBlocker, epicOptions, labelOptions, laneOptions, milestoneOptions, moveToParent, newItem, peopleOptions, promoteToEpic,
  removeBlocker, setAssignees, setLabels, setLane, setMilestone, setOption, setState, setTitle, splitItem, setField,
} from "../model/edits";
import { isEpic, laneOf, priorityOf, releaseOf, statusOf, type Mapping } from "../model/mapping";
import type { Item, Project } from "../model/normalize";
import { datesOp, isNewKey } from "../model/ops";
import type { Conflict, Draft, Schedule } from "../model/schedule";
import { Drawer } from "../ui/Drawer";
import { PickButton, PickList } from "../ui/Picker";
import type { Editor } from "./useChangeSet";

const SOURCE_LABEL: Record<string, string> = {
  fields: "date fields", iteration: "iteration", milestone: "milestone due date", children: "span of its sub-issues", draft: "your draft",
};
const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function ItemDrawer({ item, project, mapping, schedule, original, draft, conflicts, onClose, editor, onMove, onOpen }: {
  item: Item; project?: Project; mapping: Mapping; schedule: Schedule; original: Schedule; draft?: Draft; conflicts: Conflict[];
  onClose: () => void;
  /** Present when edits are allowed. */
  editor?: Editor;
  onMove?: (dir: -1 | 1) => void;
  /** Opens another item in the drawer (e.g. a sub-issue). */
  onOpen?: (key: string) => void;
}) {
  const bar = schedule.bars.get(item.key);
  const orig = original.bars.get(item.key);
  const kids = schedule.children.get(item.key) ?? [];
  const release = releaseOf(item, mapping);
  const prio = priorityOf(item, mapping);
  const mine = conflicts.filter(c => c.key === item.key);
  const parked = draft?.parked.includes(item.key) ?? false;
  const moved = !!draft?.bars[item.key] || (!!bar && (!orig || orig.start !== bar.start || orig.end !== bar.end));
  const epic = isEpic(item, mapping);
  const p = project;
  const can = !!editor && !!p && item.kind !== "redacted";
  const rec = (label: string, ops: Parameters<Editor["record"]>[1]) => editor?.record(label, ops);

  const [title, setTitleText] = useState(item.title);
  useEffect(() => setTitleText(item.title), [item.title, item.key]);
  const [panel, setPanel] = useState<null | "split" | "story" | "blocker" | "archive">(null);
  useEffect(() => setPanel(null), [item.key]);

  const setDate = (which: "start" | "end", value: string) => {
    if (!editor) return;
    const next = { start: bar?.start ?? value, end: bar?.end ?? value, [which]: value };
    if (next.start > next.end) { if (which === "start") next.end = next.start; else next.start = next.end; }
    rec(`Set ${item.title} to ${fmt(next.start)} – ${fmt(next.end)}`, [datesOp(item, mapping, next.start, next.end)]);
  };
  const singleField = (name: string | null) => (name ? p?.fields.find(f => f.name === name && f.kind === "single") : undefined);
  const statusDef = singleField(mapping.statusField);
  const prioDef = mapping.priority.kind === "field" ? singleField(mapping.priority.field) : undefined;
  const iterDef = mapping.iterationField ? p?.fields.find(f => f.name === mapping.iterationField && f.kind === "iteration") : undefined;
  const parent = item.parentKey ? schedule.byKey.get(item.parentKey) : undefined;

  return (
    <Drawer
      title={item.title}
      eyebrow={[epic ? "Epic" : item.kind === "pr" ? "Pull request" : item.kind === "draft" ? "Draft" : "Issue", laneOf(item, mapping), isNewKey(item.key) ? "new, not on GitHub yet" : null].filter(Boolean).join(" · ")}
      onClose={onClose}
      meta={<>
        {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer">{item.key} on GitHub ↗</a>}
        <span>State: <b>{item.state}</b>{item.stateReason === "NOT_PLANNED" && " (not planned)"}</span>
        {!can && statusOf(item, mapping) && <span>Status: <b>{statusOf(item, mapping)}</b></span>}
        {!can && prio && <span>Priority: <b>{prio.name}</b></span>}
        {!can && release && <span>Release: <b>{release.title}</b>{release.due && ` (due ${fmt(release.due)})`}</span>}
        {!can && item.assignees.length > 0 && <span>Assigned: {item.assignees.join(", ")}</span>}
      </>}
    >
      {can && p && (
        <div className="edit-grid">
          <label className="field-edit wide" htmlFor="ed-title">
            <span className="pb-label">Title</span>
            <input id="ed-title" className="input title-input" value={title} onChange={e => setTitleText(e.target.value)}
              onBlur={() => rec(`Renamed to “${title.trim()}”`, setTitle(item, title))}
              onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setTitleText(item.title); }} />
          </label>
          {statusDef?.kind === "single" && (
            <PickButton id="ed-status" label={statusDef.name} value={statusOf(item, mapping) ?? ""} options={[{ value: "", label: "None" }, ...statusDef.options.map(o => ({ value: o.name, label: o.name }))]}
              onPick={v => rec(`${item.title}: ${statusDef.name} → ${v || "none"}`, setOption(p, item, statusDef.name, v || null))} />
          )}
          {prioDef?.kind === "single" && (
            <PickButton id="ed-prio" label={prioDef.name} value={prio?.name ?? ""} options={[{ value: "", label: "None" }, ...prioDef.options.map(o => ({ value: o.name, label: o.name }))]}
              onPick={v => rec(`${item.title}: ${prioDef.name} → ${v || "none"}`, setOption(p, item, prioDef.name, v || null))} />
          )}
          {mapping.lane.kind !== "none" && (
            <PickButton id="ed-lane" label="Lane" value={laneOf(item, mapping) ?? ""} options={laneOptions(p, mapping).map(l => ({ value: l, label: l }))}
              onPick={v => rec(`Moved ${item.title} to lane ${v}`, setLane(p, mapping, item, v))} />
          )}
          {mapping.release.kind === "milestone" && item.kind !== "draft" && (
            <PickButton id="ed-release" label="Release" value={item.milestone?.title ?? ""}
              options={[{ value: "", label: "None" }, ...milestoneOptions(p, item.repo).map(ms => ({ value: ms.title, label: ms.title, hint: ms.dueOn ? `due ${ms.dueOn.slice(0, 10)}` : undefined }))]}
              onPick={v => rec(`${item.title}: release → ${v || "none"}`, setMilestone(item, v ? milestoneOptions(p, item.repo).find(ms => ms.title === v) ?? null : null))} />
          )}
          {iterDef?.kind === "iteration" && (
            <PickButton id="ed-iter" label={iterDef.name} value={(() => { const v = item.fields[iterDef.name]; return v?.kind === "iteration" ? v.title : ""; })()}
              options={[{ value: "", label: "None" }, ...iterDef.iterations.filter(i => !i.completed).map(i => ({ value: i.id, label: i.title, hint: i.startDate }))]}
              onPick={v => { const it = iterDef.iterations.find(i => i.id === v); rec(`${item.title}: ${iterDef.name} → ${it?.title ?? "none"}`, setField(item, iterDef.name, it ? { kind: "iteration", title: it.title, startDate: it.startDate, duration: it.duration, iterationId: it.id } : null)); }} />
          )}
          <PickButton id="ed-owners" label="Owners" multi value={item.assignees.join(", ")} selected={item.assignees}
            options={peopleOptions(p).map(l => ({ value: l, label: l }))}
            onPick={v => rec(`${item.title}: owners updated`, setAssignees(item, item.assignees.includes(v) ? item.assignees.filter(a => a !== v) : [...item.assignees, v]))} />
          <PickButton id="ed-labels" label="Labels" multi value={item.labels.join(", ")} selected={item.labels}
            options={labelOptions(p).map(l => ({ value: l, label: l }))}
            onPick={v => rec(`${item.title}: labels updated`, setLabels(item, item.labels.includes(v) ? item.labels.filter(a => a !== v) : [...item.labels, v]))} />
          <PickButton id="ed-parent" label="Epic" value={parent?.title ?? ""}
            options={[{ value: "", label: "Not under an epic" }, ...epicOptions(p, mapping).filter(e => e.key !== item.key).map(e => ({ value: e.key, label: e.title, hint: laneOf(e, mapping) ?? undefined }))]}
            onPick={v => rec(v ? `Moved ${item.title} under ${schedule.byKey.get(v)?.title}` : `Took ${item.title} out of its epic`, moveToParent(p, item, v || null))} />
        </div>
      )}

      <div>
        <h3>Window</h3>
        {bar ? <p>{fmt(bar.start)} – {fmt(bar.end)} <span className="muted">from {SOURCE_LABEL[bar.source]}</span></p> : <p className="muted">No dates yet.</p>}
        {moved && orig && <p className="muted" style={{ marginTop: 4 }}>On GitHub: {fmt(orig.start)} – {fmt(orig.end)}</p>}
        {can && (
          <div className="dates-edit" style={{ marginTop: 10 }}>
            <label htmlFor="d-start">Start<input id="d-start" type="date" value={bar?.start ?? ""} onChange={e => e.target.value && setDate("start", e.target.value)} /></label>
            <label htmlFor="d-end">End<input id="d-end" type="date" value={bar?.end ?? ""} onChange={e => e.target.value && setDate("end", e.target.value)} /></label>
          </div>
        )}
      </div>

      {can && p && (
        <div className="drow">
          {item.state === "open" ? (
            <>
              <button className="btn" onClick={() => rec(`Closed ${item.title}`, setState(item, "closed", "COMPLETED"))}>Close as done</button>
              <button className="btn" onClick={() => rec(`Closed ${item.title} as not planned`, setState(item, "closed", "NOT_PLANNED"))}>Not planned</button>
            </>
          ) : <button className="btn" onClick={() => rec(`Reopened ${item.title}`, setState(item, "open"))}>Reopen</button>}
          {epic && <button className="btn" onClick={() => setPanel(panel === "story" ? null : "story")}>+ Story</button>}
          <button className="btn" onClick={() => setPanel(panel === "split" ? null : "split")}>Split…</button>
          {!epic && mapping.epic.label && <button className="btn" onClick={() => rec(`Promoted ${item.title} to an epic`, promoteToEpic(mapping, item))}>Make it an epic</button>}
          <button className="btn" onClick={() => rec(`${parked ? "Put back" : "Parked"} ${item.title}`, [{ kind: "park", key: item.key, before: parked, after: !parked }])}>{parked ? "Put back on the chart" : "Park"}</button>
          {onMove && <><button className="btn" onClick={() => onMove(-1)}>Move up</button><button className="btn" onClick={() => onMove(1)}>Move down</button></>}
          <button className="btn" onClick={() => editor!.discard(item.key)}>Undo all changes to this item</button>
          <button className="btn danger" onClick={() => setPanel(panel === "archive" ? null : "archive")}>Remove from project…</button>
        </div>
      )}

      {can && p && panel === "story" && <NewStory onCreate={t => { rec(`Added “${t}” under ${item.title}`, newItem(p, mapping, t, { parentKey: item.key })); setPanel(null); }} onCancel={() => setPanel(null)} />}
      {can && p && panel === "split" && <SplitPanel item={item} kids={kids} onSplit={(t, keys) => { rec(`Split ${item.title}: new “${t}” with ${keys.length} sub-issue${keys.length === 1 ? "" : "s"}`, splitItem(p, mapping, item, t, keys)); setPanel(null); }} onCancel={() => setPanel(null)} />}
      {can && panel === "archive" && (
        <div className="callout warn" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>Remove “{item.title}” from this project? The issue itself stays on GitHub.</span>
          <button className="btn" onClick={() => { rec(`Removed ${item.title} from the project`, [{ kind: "archive", key: item.key }]); onClose(); }}>Remove</button>
          <button className="btn ghost" onClick={() => setPanel(null)}>Keep</button>
        </div>
      )}

      {mine.length > 0 && (
        <div>
          <h3>Conflicts</h3>
          {mine.map(c => <p key={c.blocker} className="callout bad" style={{ marginTop: 6 }}>Blocked by {schedule.byKey.get(c.blocker)?.title ?? c.blocker}. {c.message}.</p>)}
        </div>
      )}

      {(item.blockedBy.length > 0 || can) && (
        <div>
          <h3>Blocked by</h3>
          {item.blockedBy.map(b => { const it = schedule.byKey.get(b.key); return (
            <p key={b.key} className="dep"><span className={b.open ? "pill warn" : "pill good"}>{b.open ? "Open" : "Done"}</span>
              {it?.url ? <a href={it.url} target="_blank" rel="noopener noreferrer">{it.title}</a> : (it?.title ?? b.key)}
              {can && <button className="linkbtn" onClick={() => rec(`${item.title} no longer blocked by ${it?.title ?? b.key}`, removeBlocker(item, b.key))}>remove</button>}</p>
          ); })}
          {can && p && (panel === "blocker"
            ? <div className="card pad" style={{ marginTop: 6 }}><PickList placeholder="Find the item that blocks this one…"
                options={p.items.filter(i => i.key !== item.key && i.state === "open" && !item.blockedBy.some(b => b.key === i.key)).map(i => ({ value: i.key, label: i.title, hint: i.number ? `#${i.number}` : undefined }))}
                onPick={v => { const ops = addBlocker(p, item, v); if (ops.length) rec(`${item.title} now blocked by ${schedule.byKey.get(v)?.title}`, ops); setPanel(null); }}
                emptyText="No open items match" /></div>
            : <button className="btn" style={{ marginTop: 4 }} onClick={() => setPanel("blocker")}>+ Add a blocker</button>)}
        </div>
      )}

      {kids.length > 0 && (
        <div>
          <h3>Sub-issues ({kids.filter(k => k.state !== "open").length}/{kids.length} done)</h3>
          <div style={{ display: "grid", gap: 4 }}>
            {kids.map(k => { const b = schedule.bars.get(k.key); return (
              <div key={k.key} className="story">
                <span className={k.state === "open" ? "pill" : "pill good"}>{k.state === "open" ? "Open" : "Done"}</span>
                <span>{onOpen ? <button className="linkish" onClick={() => onOpen(k.key)}>{k.title}</button> : k.url ? <a href={k.url} target="_blank" rel="noopener noreferrer">{k.title}</a> : k.title}
                  {b && <span className="muted num" style={{ fontSize: 11 }}> · {b.start} → {b.end}</span>}</span>
              </div>
            ); })}
          </div>
        </div>
      )}
    </Drawer>
  );
}

function NewStory({ onCreate, onCancel }: { onCreate: (title: string) => void; onCancel: () => void }) {
  const [t, setT] = useState("");
  return (
    <form className="card pad" style={{ display: "flex", gap: 8 }} onSubmit={e => { e.preventDefault(); if (t.trim()) onCreate(t.trim()); }}>
      <input id="new-story" className="input" style={{ fontFamily: "var(--f-body)" }} autoFocus placeholder="New story title" value={t} onChange={e => setT(e.target.value)}
        onKeyDown={e => { if (e.key === "Escape") onCancel(); }} />
      <button className="btn primary" type="submit" disabled={!t.trim()}>Add</button>
    </form>
  );
}

function SplitPanel({ item, kids, onSplit, onCancel }: { item: Item; kids: Item[]; onSplit: (title: string, keys: string[]) => void; onCancel: () => void }) {
  const [t, setT] = useState(`${item.title} (part 2)`);
  const [picked, setPicked] = useState<Set<string>>(new Set(kids.filter(k => k.state === "open").slice(Math.ceil(kids.filter(k => k.state === "open").length / 2)).map(k => k.key)));
  return (
    <form className="card pad" style={{ display: "grid", gap: 8 }} onSubmit={e => { e.preventDefault(); onSplit(t.trim(), [...picked]); }}>
      <label htmlFor="split-title" style={{ fontWeight: 700 }}>New item</label>
      <input id="split-title" className="input" style={{ fontFamily: "var(--f-body)" }} autoFocus value={t} onChange={e => setT(e.target.value)} />
      {kids.length > 0 && <>
        <span className="muted" style={{ fontSize: 12 }}>Sub-issues to move to the new item:</span>
        <div style={{ display: "grid", gap: 4, maxHeight: 200, overflow: "auto" }}>
          {kids.map(k => (
            <label key={k.key} className="check-row"><input type="checkbox" checked={picked.has(k.key)}
              onChange={e => { const n = new Set(picked); e.target.checked ? n.add(k.key) : n.delete(k.key); setPicked(n); }} /> {k.title}{k.state !== "open" && <span className="muted"> (done)</span>}</label>
          ))}
        </div>
      </>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary" type="submit" disabled={!t.trim()}>Split</button>
        <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
