import { isEpic, laneOf, priorityOf, releaseOf, statusOf, type Mapping } from "../model/mapping";
import type { Item } from "../model/normalize";
import type { Conflict, Draft, Schedule } from "../model/schedule";
import { datesOp } from "../model/ops";
import { Drawer } from "../ui/Drawer";
import type { Editor } from "./useChangeSet";

const SOURCE_LABEL: Record<string, string> = {
  fields: "date fields", iteration: "iteration", milestone: "milestone due date", children: "span of its sub-issues", draft: "your draft",
};
const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function ItemDrawer({ item, mapping, schedule, original, draft, conflicts, onClose, editor, onMove }: {
  item: Item; mapping: Mapping; schedule: Schedule; original: Schedule; draft?: Draft; conflicts: Conflict[];
  onClose: () => void;
  /** Present when edits are allowed. */
  editor?: Editor;
  onMove?: (dir: -1 | 1) => void;
}) {
  const bar = schedule.bars.get(item.key);
  const orig = original.bars.get(item.key);
  const kids = schedule.children.get(item.key) ?? [];
  const release = releaseOf(item, mapping);
  const prio = priorityOf(item, mapping);
  const mine = conflicts.filter(c => c.key === item.key);
  const parked = draft?.parked.includes(item.key) ?? false;
  const moved = !!draft?.bars[item.key] || (!!bar && (!orig || orig.start !== bar.start || orig.end !== bar.end));

  const setDate = (which: "start" | "end", value: string) => {
    if (!editor) return;
    const next = { start: bar?.start ?? value, end: bar?.end ?? value, [which]: value };
    if (next.start > next.end) { if (which === "start") next.end = next.start; else next.start = next.end; }
    editor.record(`Set ${item.title} to ${fmt(next.start)} – ${fmt(next.end)}`, [datesOp(item, mapping, next.start, next.end)]);
  };

  return (
    <Drawer
      title={item.title}
      eyebrow={[isEpic(item, mapping) ? "Epic" : item.kind === "pr" ? "Pull request" : item.kind === "draft" ? "Draft" : "Issue", laneOf(item, mapping)].filter(Boolean).join(" · ")}
      onClose={onClose}
      meta={<>
        {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer">{item.key} on GitHub ↗</a>}
        <span>State: <b>{item.state}</b></span>
        {statusOf(item, mapping) && <span>Status: <b>{statusOf(item, mapping)}</b></span>}
        {prio && <span>Priority: <b>{prio.name}</b></span>}
        {release && <span>Release: <b>{release.title}</b>{release.due && ` (due ${fmt(release.due)})`}</span>}
        {item.assignees.length > 0 && <span>Assigned: {item.assignees.join(", ")}</span>}
      </>}
    >
      <div>
        <h3>Window</h3>
        {bar ? <p>{fmt(bar.start)} – {fmt(bar.end)} <span className="muted">from {SOURCE_LABEL[bar.source]}</span></p> : <p className="muted">No dates. Set them on GitHub, or drag it onto the chart from the tray.</p>}
        {moved && orig && <p className="muted" style={{ marginTop: 4 }}>On GitHub: {fmt(orig.start)} – {fmt(orig.end)}</p>}
        {editor && (
          <div className="dates-edit" style={{ marginTop: 10 }}>
            <label htmlFor="d-start">Start<input id="d-start" type="date" value={bar?.start ?? ""} onChange={e => e.target.value && setDate("start", e.target.value)} /></label>
            <label htmlFor="d-end">End<input id="d-end" type="date" value={bar?.end ?? ""} onChange={e => e.target.value && setDate("end", e.target.value)} /></label>
          </div>
        )}
      </div>

      {editor && (
        <div className="drow">
          {onMove && <><button className="btn" onClick={() => onMove(-1)}>Move up</button><button className="btn" onClick={() => onMove(1)}>Move down</button></>}
          <button className="btn" onClick={() => editor.discard(item.key)}>Undo all changes to this item</button>
          <button className="btn" onClick={() => editor.record(`${parked ? "Put back" : "Parked"} ${item.title}`, [{ kind: "park", key: item.key, before: parked, after: !parked }])}>
            {parked ? "Put back on the chart" : "Park"}
          </button>
        </div>
      )}

      {mine.length > 0 && (
        <div>
          <h3>Conflicts</h3>
          {mine.map(c => <p key={c.blocker} className="callout bad" style={{ marginTop: 6 }}>Blocked by {schedule.byKey.get(c.blocker)?.title ?? c.blocker}. {c.message}.</p>)}
        </div>
      )}

      {item.blockedBy.length > 0 && (
        <div>
          <h3>Blocked by</h3>
          {item.blockedBy.map(b => { const it = schedule.byKey.get(b.key); return (
            <p key={b.key} className="dep"><span className={b.open ? "pill warn" : "pill good"}>{b.open ? "Open" : "Done"}</span> {it?.url ? <a href={it.url} target="_blank" rel="noopener noreferrer">{it.title}</a> : b.key}</p>
          ); })}
        </div>
      )}

      {kids.length > 0 && (
        <div>
          <h3>Sub-issues ({kids.filter(k => k.state !== "open").length}/{kids.length} done)</h3>
          <div style={{ display: "grid", gap: 4 }}>
            {kids.map(k => { const b = schedule.bars.get(k.key); return (
              <div key={k.key} className="story">
                <span className={k.state === "open" ? "pill" : "pill good"}>{k.state === "open" ? "Open" : "Done"}</span>
                <span>{k.url ? <a href={k.url} target="_blank" rel="noopener noreferrer">{k.title}</a> : k.title}
                  {b && <span className="muted num" style={{ fontSize: 11 }}> · {b.start} → {b.end}</span>}</span>
              </div>
            ); })}
          </div>
        </div>
      )}
    </Drawer>
  );
}
