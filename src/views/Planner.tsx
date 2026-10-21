// The planner. Three questions, in the order you would actually ask them:
//
//   1. Is it already here?  — describe the work and see whether an epic already covers it.
//   2. Write it.            — a model on this computer drafts an epic, or a whole plan.
//   3. Tidy an epic.        — a model reads an epic's stories and says what is missing.
//
// Everything ends in the review screen, so nothing reaches GitHub until you say so.
import { useMemo, useState } from "react";
import { checkAmend, checkEpic, checkPlan, promptAmend, promptEpic, promptPlan, SYSTEM_AMEND, SYSTEM_EPIC, SYSTEM_PLAN, type PlanContext } from "../ai/plan";
import { chatJson, defaultLocal, type LocalSettings } from "../ai/local";
import { isEpic, releaseOf, type Mapping } from "../model/mapping";
import type { Project } from "../model/normalize";
import { checkDraft, draftOps, estimate, summariseDraft, type PlanDraft } from "../model/plan/draft";
import { amendmentOps, epicStories, type Amendments } from "../model/plan/amend";
import { matchEpics, type EpicMatch } from "../model/plan/match";
import { newItem } from "../model/edits";
import type { Editor } from "./useChangeSet";
import { VoiceInput } from "./voice/VoiceInput";

type Mode = "match" | "write" | "amend";

export function Planner({ project, mapping, editor, local }: {
  project: Project;
  mapping: Mapping;
  editor?: Editor;
  /** The model on this computer, if there is one. */
  local?: LocalSettings;
}) {
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<Mode>("match");
  const [shape, setShape] = useState<"epic" | "plan">("epic");
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  // "Tidy an epic"
  const [amendKey, setAmendKey] = useState<string | null>(null);
  const [amendments, setAmendments] = useState<Amendments | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const settings = local ?? defaultLocal;

  const context = useMemo<PlanContext>(() => ({
    epics: project.items.filter(i => isEpic(i, mapping)).slice(0, 40).map(i => i.title),
    releases: [...new Set(project.items.map(i => releaseOf(i, mapping)?.title).filter((r): r is string => !!r))].slice(0, 20),
    labels: [...new Set(project.items.flatMap(i => i.labels))].slice(0, 25),
    people: [...new Set(project.items.flatMap(i => i.assignees))].slice(0, 25),
    startField: mapping.startField, endField: mapping.endField,
    today: new Date().toISOString().slice(0, 10),
  }), [project, mapping]);

  const epics = useMemo(() => project.items.filter(i => isEpic(i, mapping) && i.state === "open").sort((a, b) => a.title.localeCompare(b.title)), [project, mapping]);
  const amendEpic = project.items.find(i => i.key === amendKey) ?? null;

  // Does this already exist?
  const matches: EpicMatch[] = useMemo(
    () => (mode === "match" && description.trim() ? matchEpics(project, mapping, description) : []),
    [mode, description, project, mapping],
  );

  async function draftIt() {
    if (!settings.enabled) { setError("Turn on a local model in Settings to have it write a plan."); return; }
    if (!description.trim()) { setError("Say what you want to build first."); return; }
    setWorking(true); setError(null); setMsg(null);
    // One epic and a whole plan are the same shape from here on.
    let asDraft: PlanDraft | null = null;
    if (shape === "epic") {
      const answer = await chatJson(settings, SYSTEM_EPIC, promptEpic(description, context.releases, context.labels, context.today), checkEpic);
      if (answer) asDraft = { name: answer.title, summary: answer.summary, epics: [{ ...answer, why: answer.summary, after: [] }] };
    } else {
      const answer = await chatJson(settings, SYSTEM_PLAN, promptPlan(context, description), checkPlan);
      if (answer) asDraft = answer;
    }
    setWorking(false);
    if (!asDraft) { setError("The model did not answer with a plan. Try again, or write the plan yourself."); return; }
    const checked = checkDraft(project, mapping, asDraft);
    setDraft(checked.draft);
    setProblems(checked.problems);
    setKept(new Set(checked.draft.epics.map(e => e.title)));
  }

  async function amendIt() {
    if (!settings.enabled) { setError("Turn on a local model in Settings to have it read the epic."); return; }
    if (!amendEpic) { setError("Choose an epic first."); return; }
    setWorking(true); setError(null); setMsg(null);
    const answer = await chatJson(settings, SYSTEM_AMEND,
      promptAmend({ title: amendEpic.title, body: (amendEpic.body ?? "").slice(0, 300) }, epicStories(project, amendEpic), context.releases),
      checkAmend);
    setWorking(false);
    if (!answer) { setError("The model did not answer. Try again, or make the changes yourself."); return; }
    // The story keys have to be ones this epic really has.
    const keys = new Set(epicStories(project, amendEpic).map(s => s.key));
    const checked: Amendments = {
      add: answer.add,
      rename: answer.rename.filter(r => keys.has(r.key)),
      overlap: answer.overlap.filter(o => o.keys.every(k => keys.has(k))),
    };
    setAmendments(checked);
    setPicked(new Set([
      ...checked.add.map(a => `add:${a.title}`),
      ...checked.rename.map(r => `rename:${r.key}`),
    ]));
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

  /** Adds the pieces nothing covered to the epic that covers the rest. */
  function addMissing(match: EpicMatch) {
    if (!editor || !match.missing.length) return;
    const ops = match.missing.flatMap(m => newItem(project, mapping, m.text, { parentKey: match.epic.key }));
    if (!ops.length) return;
    editor.record(`Added ${match.missing.length} stories to ${match.epic.title}`, ops);
    setMsg(`${match.missing.length} ${match.missing.length === 1 ? "story is" : "stories are"} waiting in your draft. Review them, then apply.`);
  }

  function addAmendments() {
    if (!editor || !amendments || !amendEpic) return;
    const changes = amendmentOps(project, amendEpic, amendments, picked);
    const ops = changes.flatMap(c => c.ops);
    if (!ops.length) return;
    editor.record(`Tidied ${amendEpic.title} (${changes.length} changes)`, ops);
    setMsg(`${changes.length} ${changes.length === 1 ? "change is" : "changes are"} waiting in your draft. Review them, then apply.`);
  }

  const amendChanges = useMemo(
    () => (amendments && amendEpic ? amendmentOps(project, amendEpic, amendments, picked) : []),
    [amendments, amendEpic, picked, project],
  );

  return (
    <div className="emap">
      <div className="section-h">
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800 }}>Planner</h1>
          <p className="muted" style={{ maxWidth: "80ch" }}>
            Start with what you want to build. pm-hub will tell you whether an epic already covers it, write a new one,
            or tidy one you have. Nothing is written to GitHub until you apply it.
          </p>
        </div>
      </div>

      <div className="planner">
        <div className="seg" role="group" aria-label="What to do">
          <button className={mode === "match" ? "on" : ""} onClick={() => setMode("match")}>Is it already here?</button>
          <button className={mode === "write" ? "on" : ""} onClick={() => setMode("write")}>Write it</button>
          <button className={mode === "amend" ? "on" : ""} onClick={() => setMode("amend")}>Tidy an epic</button>
        </div>

        {mode === "amend" ? (
          <section className="card pad" style={{ display: "grid", gap: 10 }}>
            <div className="setting">
              <label htmlFor="plan-epic">Which epic?</label>
              <select id="plan-epic" className="input" value={amendKey ?? ""} onChange={e => { setAmendKey(e.target.value || null); setAmendments(null); }}>
                <option value="">Choose an epic…</option>
                {epics.map(e => <option key={e.key} value={e.key}>{e.title}</option>)}
              </select>
            </div>
            <div className="drow">
              <button className="btn primary" onClick={() => void amendIt()} disabled={working || !amendEpic || !settings.enabled}>
                {working ? "Reading it…" : "What should change?"}
              </button>
              {!settings.enabled && <span className="muted" style={{ fontSize: 12 }}>Turn on a local model in Settings first.</span>}
            </div>
            {amendments && amendEpic && (
              <div style={{ display: "grid", gap: 8 }}>
                {amendments.add.length > 0 && (
                  <div>
                    <h4 style={{ fontSize: 12, marginBottom: 4 }}>It is missing</h4>
                    {amendments.add.map(a => (
                      <label key={a.title} className="check-row" style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                        <input type="checkbox" checked={picked.has(`add:${a.title}`)} onChange={e => setPicked(p => { const n = new Set(p); e.target.checked ? n.add(`add:${a.title}`) : n.delete(`add:${a.title}`); return n; })} />
                        <span><b>{a.title}</b> <span className="muted">· {a.why}</span></span>
                      </label>
                    ))}
                  </div>
                )}
                {amendments.rename.length > 0 && (
                  <div>
                    <h4 style={{ fontSize: 12, marginBottom: 4 }}>Named badly</h4>
                    {amendments.rename.map(r => (
                      <label key={r.key} className="check-row" style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                        <input type="checkbox" checked={picked.has(`rename:${r.key}`)} onChange={e => setPicked(p => { const n = new Set(p); e.target.checked ? n.add(`rename:${r.key}`) : n.delete(`rename:${r.key}`); return n; })} />
                        <span><b>{r.from}</b> → {r.to} <span className="muted">· {r.why}</span></span>
                      </label>
                    ))}
                  </div>
                )}
                {amendments.overlap.length > 0 && (
                  <div>
                    <h4 style={{ fontSize: 12, marginBottom: 4 }}>These repeat each other</h4>
                    {amendments.overlap.map(o => (
                      <label key={o.keys[0]} className="check-row" style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                        <input type="checkbox" checked={picked.has(`archive:${o.keys[0]}`)} onChange={e => setPicked(p => { const n = new Set(p); e.target.checked ? n.add(`archive:${o.keys[0]}`) : n.delete(`archive:${o.keys[0]}`); return n; })} />
                        <span><b>{o.titles[0]}</b> and {o.titles[1]} <span className="muted">· {o.why}</span></span>
                      </label>
                    ))}
                  </div>
                )}
                {!amendments.add.length && !amendments.rename.length && !amendments.overlap.length && (
                  <p className="muted">The model did not find anything to change.</p>
                )}
                <div className="emap-card-actions">
                  <button className="btn primary" disabled={!editor || !amendChanges.length} onClick={addAmendments}>
                    Add {amendChanges.length} {amendChanges.length === 1 ? "change" : "changes"} to the plan
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : (
          <section className="card pad" style={{ display: "grid", gap: 10 }}>
            {mode === "write" && (
              <div className="seg" role="group" aria-label="What to write" style={{ justifySelf: "start" }}>
                <button className={shape === "epic" ? "on" : ""} onClick={() => setShape("epic")}>One epic</button>
                <button className={shape === "plan" ? "on" : ""} onClick={() => setShape("plan")}>A whole plan</button>
              </div>
            )}
            <div className="setting">
              <label htmlFor="plan-what">{mode === "match" ? "What are you building?" : shape === "epic" ? "What is this epic for?" : "What are you building?"}</label>
              <VoiceInput value={description} onChange={setDescription} settings={settings} id="plan-what"
                placeholder={mode === "match"
                  ? "A billing rework: an invoice screen, a payment retry service, and a refund flow."
                  : "A new epic for the billing rework, with the invoice screen and the retry service."} />
            </div>
            {mode === "match" ? (
              matches.length === 0 ? (
                <p className="muted">{description.trim()
                  ? "Nothing in the project looks like that yet."
                  : "Describe the work, or paste the stories you have in mind, and pm-hub will look for an epic that already covers them."}</p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {matches.map(m => (
                    <div key={m.epic.key} className="plan-sugg">
                      <div className="plan-sugg-title">
                        <b>{m.epic.title}</b> <span className="muted">· covers {m.covered.length} of {m.covered.length + m.missing.length}</span>
                      </div>
                      <ul className="emap-list">
                        {m.covered.map(c => (
                          <li key={c.text}><span className="good">✓</span> {c.text} <span className="muted">— already in “{c.story}”</span></li>
                        ))}
                        {m.missing.map(c => (
                          <li key={c.text}><span className="muted">✗</span> {c.text} <span className="muted">— not there yet</span></li>
                        ))}
                      </ul>
                      {m.missing.length > 0 && (
                        <div className="emap-card-actions">
                          <button className="btn small" onClick={() => addMissing(m)} disabled={!editor}>
                            Add the {m.missing.length} missing to this epic
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="drow">
                <button className="btn primary" onClick={() => void draftIt()} disabled={working || !settings.enabled}>
                  {working ? "Writing…" : "Write it"}
                </button>
                {!settings.enabled && <span className="muted" style={{ fontSize: 12 }}>Turn on a local model in Settings first.</span>}
              </div>
            )}
            {error && <p className="callout bad">{error}</p>}
            {msg && <p className="callout info">{msg}</p>}
          </section>
        )}

        {mode === "write" && draft && (
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
                  {e.summary && <div className="plan-summary">{e.summary}</div>}
                  {e.why && !e.summary && <div className="muted">{e.why}</div>}
                  {e.stories.length > 0 && (
                    <ul className="emap-list" style={{ marginTop: 2 }}>
                      {e.stories.map(s => {
                        const est = estimate(s);
                        return <li key={s.title}><span className="muted">{est.expected}d{est.low !== est.high ? ` (${est.low}–${est.high})` : ""}</span> {s.title}</li>;
                      })}
                    </ul>
                  )}
                  {e.after.length > 0 && <div className="muted">after: {e.after.join(", ")}</div>}
                </li>
              ))}
            </ul>
            <div className="emap-card-actions">
              <button className="btn primary" onClick={addToPlan} disabled={!editor || !chosen || !chosen.epics.length}>Add to the plan</button>
              {!editor && <span className="muted" style={{ fontSize: 12 }}>Turn off “GitHub only” to add the plan to your draft.</span>}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
