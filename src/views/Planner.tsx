// The planner: describe what you want to build, and a model on this computer drafts the
// plan — epics, their stories, their dates, their release and what has to happen first.
// The draft is reviewed here, and only then added to the plan as one change.
import { useMemo, useState } from "react";
import { checkPlan, promptPlan, SYSTEM_PLAN, type PlanContext } from "../ai/plan";
import { chatJson, defaultLocal, type LocalSettings } from "../ai/local";
import { isEpic, releaseOf } from "../model/mapping";
import type { Project } from "../model/normalize";
import { checkDraft, draftOps, summariseDraft, type PlanDraft } from "../model/plan/draft";
import type { Editor } from "./useChangeSet";
import { VoiceInput } from "./voice/VoiceInput";

export function Planner({ project, mapping, editor, local }: {
  project: Project;
  mapping: import("../model/mapping").Mapping;
  editor?: Editor;
  /** The model on this computer, if there is one. */
  local?: LocalSettings;
}) {
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const settings = local ?? defaultLocal;

  const context = useMemo<PlanContext>(() => ({
    epics: project.items.filter(i => isEpic(i, mapping)).slice(0, 40).map(i => i.title),
    releases: [...new Set(project.items.map(i => releaseOf(i, mapping)?.title).filter((r): r is string => !!r))].slice(0, 20),
    labels: [...new Set(project.items.flatMap(i => i.labels))].slice(0, 25),
    people: [...new Set(project.items.flatMap(i => i.assignees))].slice(0, 25),
    startField: mapping.startField, endField: mapping.endField,
    today: new Date().toISOString().slice(0, 10),
  }), [project, mapping]);

  async function draftIt() {
    if (!settings.enabled) { setError("Turn on a local model in Settings to have it write a plan."); return; }
    if (!description.trim()) { setError("Say what you want to build first."); return; }
    setWorking(true); setError(null); setMsg(null);
    const answer = await chatJson(settings, SYSTEM_PLAN, promptPlan(context, description), checkPlan);
    setWorking(false);
    if (!answer) { setError("The model did not answer with a plan. Try again, or write the plan yourself."); return; }
    const checked = checkDraft(project, mapping, answer);
    setDraft(checked.draft);
    setProblems(checked.problems);
    setKept(new Set(checked.draft.epics.map(e => e.title)));
  }

  /** The draft as it will be added: the epics that are still ticked. */
  const chosen = useMemo(() => (draft ? { ...draft, epics: draft.epics.filter(e => kept.has(e.title)) } : null), [draft, kept]);

  function addToPlan() {
    if (!chosen || !editor) return;
    const ops = draftOps(project, mapping, chosen);
    if (!ops.length) return;
    const summary = summariseDraft(chosen);
    editor.record(`New plan: ${chosen.name} (${summary.epics} epics, ${summary.stories} stories)`, ops);
    setMsg(`${summary.epics} epics and ${summary.stories} stories are waiting in your draft. Review them, then apply.`);
  }

  return (
    <div className="emap">
      <div className="section-h">
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800 }}>Planner</h1>
          <p className="muted" style={{ maxWidth: "80ch" }}>
            Describe what you want to build. A model on this computer drafts the plan — epics, stories, dates, a release, and
            what has to happen first — and you decide what goes into the project. Nothing is written to GitHub until you apply it.
          </p>
        </div>
      </div>

      <div className="planner">
        <div>
          <section className="card pad" style={{ display: "grid", gap: 10 }}>
            <div className="setting">
              <label htmlFor="plan-what">What are you building?</label>
              <VoiceInput value={description} onChange={setDescription} settings={settings}
                placeholder="A billing rework: a new invoice screen, a payment retry service, and a release for March." />
            </div>
            <div className="drow">
              <button className="btn primary" onClick={() => void draftIt()} disabled={working || !settings.enabled}>
                {working ? "Writing the plan…" : "Write a plan"}
              </button>
              {!settings.enabled && <span className="muted" style={{ fontSize: 12 }}>Turn on a local model in Settings first.</span>}
              {working && <span className="muted" style={{ fontSize: 12 }}>This can take a moment.</span>}
            </div>
            {error && <p className="callout bad">{error}</p>}
            {msg && <p className="callout info">{msg}</p>}
          </section>

          {draft && (
            <section className="card pad" style={{ display: "grid", gap: 10 }}>
              <div className="section-h" style={{ marginBottom: 0 }}>
                <h3 style={{ fontSize: 15, fontWeight: 800 }}>{draft.name}</h3>
                <span className="muted" style={{ fontSize: 12 }}>{summariseDraft(chosen!).epics} epics · {summariseDraft(chosen!).stories} stories</span>
              </div>
              {draft.summary && <p className="muted">{draft.summary}</p>}
              {problems.length > 0 && (
                <div className="callout warn">
                  <b>What was left out</b>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </div>
              )}
              <ul className="emap-list">
                {draft.epics.map(e => (
                  <li key={e.title}>
                    <input type="checkbox" checked={kept.has(e.title)} aria-label={`Include ${e.title}`}
                      onChange={ev => setKept(k => { const n = new Set(k); ev.target.checked ? n.add(e.title) : n.delete(e.title); return n; })} />
                    <b>{e.title}</b>
                    <span className="muted">{e.release ?? "no release"} · {e.stories.length} stories{e.start ? ` · ${e.start} – ${e.end}` : ""}</span>
                    {e.why && <div className="muted">{e.why}</div>}
                    {e.stories.length > 0 && (
                      <ul className="emap-list" style={{ marginTop: 2 }}>
                        {e.stories.map(s => <li key={s.title}><span className="muted">{s.days}d</span> {s.title}</li>)}
                      </ul>
                    )}
                    {e.after.length > 0 && <div className="muted">after: {e.after.join(", ")}</div>}
                  </li>
                ))}
              </ul>
              <div className="drow">
                <button className="btn primary" onClick={addToPlan} disabled={!editor || !chosen || !chosen.epics.length}>Add to the plan</button>
                <button className="btn" onClick={() => exportCsv(chosen)} disabled={!chosen}>Export as CSV</button>
                <button className="btn ghost" onClick={() => { setDraft(null); setProblems([]); setKept(new Set()); }}>Discard the draft</button>
              </div>
              {!editor && <span className="muted" style={{ fontSize: 12 }}>Turn off “GitHub only” to add the plan to your draft.</span>}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** The draft as CSV, for pasting somewhere else. */
function exportCsv(draft: PlanDraft | null) {
  if (!draft) return;
  const rows = [["Epic", "Story", "Days", "Start", "End", "Release", "After", "Why"]];
  for (const e of draft.epics) {
    for (const s of e.stories) rows.push([e.title, s.title, String(s.days), e.start ?? "", e.end ?? "", e.release ?? "", e.after.join("; "), s.why || e.why]);
    if (!e.stories.length) rows.push([e.title, "", "", e.start ?? "", e.end ?? "", e.release ?? "", e.after.join("; "), e.why]);
  }
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  void navigator.clipboard?.writeText(csv);
}
