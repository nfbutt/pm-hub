// Two epics, side by side. What each covers, what they have in common, what only one
// of them has — and the stories you can drag from one to the other. The changes are
// staged in your draft like any other, and applied from the review screen.
import { useMemo, useState } from "react";
import { analyze } from "../model/epicmap";
import type { Mapping } from "../model/mapping";
import type { Project } from "../model/normalize";
import {
  comparableEpics, compareEpics, proposeMove, type Comparison, type ProposedMove,
} from "../model/plan/compare";
import type { Op } from "../model/ops";
import { Modal } from "../ui/Drawer";
import type { Editor } from "./useChangeSet";
import { useCompareAI } from "./useCompareAI";
import type { LocalSettings } from "../ai/local";

export function Compare({ project, mapping, editor, local, onGoToReview }: {
  project: Project;
  mapping: Mapping;
  editor?: Editor;
  local?: LocalSettings;
  onGoToReview?: () => void;
}) {
  const [aKey, setAKey] = useState<string | null>(null);
  const [bKey, setBKey] = useState<string | null>(null);
  const [moves, setMoves] = useState<ProposedMove[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const settings = local ?? { enabled: false, base: "", chatModel: "", embedModel: "" };

  const epics = useMemo(() => comparableEpics(project, mapping), [project, mapping]);
  const a = project.items.find(i => i.key === aKey) ?? null;
  const b = project.items.find(i => i.key === bKey) ?? null;

  // How alike the two are, from the Epic Map's own measure.
  const overlap = useMemo(() => {
    if (!a || !b) return null;
    const model = analyze(project, mapping, { openOnly: false });
    const pair = model.overlaps.find(o => (o.a === a.key && o.b === b.key) || (o.a === b.key && o.b === a.key));
    return pair?.score ?? null;
  }, [project, mapping, a, b]);

  const comparison: Comparison | null = useMemo(() => (a && b ? compareEpics(project, mapping, a, b, overlap) : null), [project, mapping, a, b, overlap]);
  const { answer, status } = useCompareAI(project, a, b, settings);

  function drop(onto: string) {
    if (!dragging || !a || !b) return;
    const story = project.items.find(i => i.key === dragging);
    setDragging(null);
    if (!story) return;
    const from = a.key === onto ? b : a;
    const to = a.key === onto ? a : b;
    const move = proposeMove(project, story, from, to);
    if (!move) return;
    setMoves(m => [...m.filter(x => x.story.key !== story.key), move]);
  }

  const chosen = moves.filter(m => m.include !== false);
  const stage = () => {
    if (!editor || !chosen.length) return;
    const ops: Op[] = chosen.flatMap(m => m.ops);
    editor.record(`Moved ${chosen.length} ${chosen.length === 1 ? "story" : "stories"} from ${chosen[0]!.from.title} to ${chosen[0]!.to.title}`, ops);
    setConfirming(false);
    setMsg(`${chosen.length} ${chosen.length === 1 ? "story is" : "stories are"} in your draft. Review them, then apply.`);
    onGoToReview?.();
  };

  return (
    <div className="emap">
      <div className="section-h">
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800 }}>Compare two epics</h1>
          <p className="muted" style={{ maxWidth: "80ch" }}>
            What each of them covers, what they have in common, and what only one of them has. Drag a story from one side
            to the other to move it; the moves go into your draft like any other change.
          </p>
        </div>
      </div>

      <section className="card pad" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div className="setting" style={{ maxWidth: 320 }}>
          <label htmlFor="cmp-a">First epic</label>
          <select id="cmp-a" className="input" value={aKey ?? ""} onChange={e => setAKey(e.target.value || null)}>
            <option value="">Choose an epic…</option>
            {epics.map(e => <option key={e.key} value={e.key}>{e.title}</option>)}
          </select>
        </div>
        <div className="setting" style={{ maxWidth: 320 }}>
          <label htmlFor="cmp-b">Second epic</label>
          <select id="cmp-b" className="input" value={bKey ?? ""} onChange={e => setBKey(e.target.value || null)}>
            <option value="">Choose an epic…</option>
            {epics.filter(e => e.key !== aKey).map(e => <option key={e.key} value={e.key}>{e.title}</option>)}
          </select>
        </div>
        {comparison && (
          <div className="muted">
            {comparison.a.stories.length} and {comparison.b.stories.length} stories
            {comparison.overlap !== null && <> · {Math.round(comparison.overlap * 100)}% alike</>}
            {comparison.shared.length > 0 && <> · in common: {comparison.shared.slice(0, 5).join(", ")}</>}
          </div>
        )}
      </section>

      {!a || !b ? (
        <p className="muted">Choose two epics to compare.</p>
      ) : !comparison ? null : (
        <div className="emap-body" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
          <div className="cmp-columns">
            <StoryColumn title={a.title} epic={a} stories={comparison.a.stories} onDrag={setDragging} onDrop={() => drop(a.key)} highlight={dragging !== null} />
            <StoryColumn title={b.title} epic={b} stories={comparison.b.stories} onDrag={setDragging} onDrop={() => drop(b.key)} highlight={dragging !== null} />
          </div>
          <div className="grid2">
            <section className="card pad">
              <h3>What a model says</h3>
              {status === "off" && <p className="muted">Turn on a local model in Settings to have it read the two epics.</p>}
              {status === "working" && <p className="muted">Reading both epics…</p>}
              {status === "unreachable" && <p className="muted">The model did not answer, or nothing it said could be checked.</p>}
              {answer && (
                <>
                  <p className="muted"><b>{a.title}</b>: {answer.answer.cover.a}</p>
                  <p className="muted"><b>{b.title}</b>: {answer.answer.cover.b}</p>
                  {answer.answer.common.length > 0 && (
                    <>
                      <h4 style={{ fontSize: 12, marginTop: 8 }}>In common</h4>
                      <ul className="emap-list">
                        {answer.answer.common.map((c, i) => (
                          <li key={i}><span>{c.text}</span><div className="muted plan-quote">“{c.evidence}”</div></li>
                        ))}
                      </ul>
                    </>
                  )}
                  {answer.answer.different.length > 0 && (
                    <>
                      <h4 style={{ fontSize: 12, marginTop: 8 }}>Different</h4>
                      <ul className="emap-list">
                        {answer.answer.different.map((c, i) => (
                          <li key={i}><span>{c.text}</span><div className="muted plan-quote">“{c.evidence}”</div></li>
                        ))}
                      </ul>
                    </>
                  )}
                  <p className="muted" style={{ fontSize: 12 }}>Every claim quotes the words it came from, so you can check it.</p>
                </>
              )}
            </section>

            {moves.length > 0 && (
              <section className="card pad" style={{ alignSelf: "start" }}>
                <h3>Changes to make</h3>
                <ul className="emap-list">
                  {moves.map(m => (
                    <li key={m.story.key}>
                      <input type="checkbox" checked={m.include !== false} aria-label={`Include ${m.story.title}`}
                        onChange={e => setMoves(all => all.map(x => x.story.key === m.story.key ? { ...x, include: e.target.checked } : x))} />
                      <span><b>{m.story.title}</b> → {m.to.title}</span>
                    </li>
                  ))}
                </ul>
                <div className="emap-card-actions">
                  <button className="btn primary" disabled={!editor || !chosen.length} onClick={() => setConfirming(true)}>
                    Apply {chosen.length} {chosen.length === 1 ? "move" : "moves"} to GitHub…
                  </button>
                  <button className="btn" onClick={() => exportMoves(chosen)}>Export as CSV</button>
                  <button className="btn ghost" onClick={() => setMoves([])}>Clear</button>
                </div>
                {!editor && <span className="muted" style={{ fontSize: 12 }}>Turn off “GitHub only” to make changes.</span>}
              </section>
            )}
            {msg && <p className="callout info">{msg}</p>}
          </div>
        </div>
      )}

      {confirming && (
        <Modal title="Apply these changes to GitHub?" onClose={() => setConfirming(false)}>
          <p>These changes will be written to GitHub when you apply them on the review screen:</p>
          <ul style={{ margin: "8px 0", paddingLeft: 18 }}>
            {chosen.map(m => <li key={m.story.key}>Move <b>{m.story.title}</b> from {m.from.title} to {m.to.title}</li>)}
          </ul>
          <p className="muted">Nothing is written yet. They go into your draft, and you will see every one of them — and the
            exact calls — before anything happens.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" onClick={stage}>Stage them and show me</button>
            <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StoryColumn({ title, epic, stories, onDrag, onDrop, highlight }: {
  title: string;
  epic: { title: string; start?: string | null; end?: string | null; release?: string | null };
  stories: { key: string; title: string }[];
  onDrag: (key: string | null) => void;
  onDrop: () => void;
  highlight: boolean;
}) {
  return (
    <div className={`card pad cmp-col ${highlight ? "drop" : ""}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onDrop(); }}>
      <h3>{title}</h3>
      <p className="muted" style={{ fontSize: 12 }}>{stories.length} stories{epic.release ? ` · ${epic.release}` : ""}</p>
      <ul className="emap-list">
        {stories.map(s => (
          <li key={s.key} draggable onDragStart={() => onDrag(s.key)} onDragEnd={() => onDrag(null)}>
            <span className="cmp-grip" aria-hidden="true">⋮⋮</span>
            <span>{s.title}</span>
          </li>
        ))}
        {!stories.length && <li className="muted">No stories.</li>}
      </ul>
    </div>
  );
}

/** The changes as CSV, for pasting somewhere else. */
function exportMoves(moves: ProposedMove[]) {
  const rows = [["Story", "From", "To", "Key"]];
  for (const m of moves) rows.push([m.story.title, m.from.title, m.to.title, m.story.key]);
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  void navigator.clipboard?.writeText(csv);
}
