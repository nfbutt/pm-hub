import { useState, type FormEvent } from "react";
import type { ChangeSetState } from "../views/useChangeSet";

/** Scenario picker, change count, undo/redo and the "GitHub only" switch, in the top bar. */
export function ChangeBar({ cs, githubOnly, setGithubOnly, reviewHref }: { cs: ChangeSetState; githubOnly: boolean; setGithubOnly: (v: boolean) => void; reviewHref: string }) {
  const [form, setForm] = useState<null | { mode: "new" | "copy" | "rename"; name: string }>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const active = cs.scenarios.list.find(s => s.id === cs.scenarios.active);
  const count = cs.net.length;

  function onSelect(v: string) {
    if (v === "__new") setForm({ mode: "new", name: `Scenario ${cs.scenarios.list.length + 1}` });
    else if (v === "__copy") setForm({ mode: "copy", name: `${active?.name ?? "Scenario"} (copy)` });
    else if (v === "__rename") setForm({ mode: "rename", name: active?.name ?? "" });
    else if (v === "__delete") setConfirmDelete(true);
    else cs.scenarios.switchTo(v);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form || !form.name.trim()) return;
    if (form.mode === "rename") cs.scenarios.rename(cs.scenarios.active, form.name.trim());
    else cs.scenarios.add(form.name.trim(), form.mode === "copy");
    setForm(null);
  }

  return (
    <div className="changebar">
      {form ? (
        <form onSubmit={submit} style={{ display: "flex", gap: 4 }}>
          <input id="scenario-name" className="input" style={{ width: 170, padding: "4px 8px", fontFamily: "var(--f-body)" }} autoFocus value={form.name}
            aria-label="Scenario name" onChange={e => setForm({ ...form, name: e.target.value })} onKeyDown={e => { if (e.key === "Escape") setForm(null); }} />
          <button className="btn" type="submit">{form.mode === "rename" ? "Rename" : "Create"}</button>
          <button className="btn ghost" type="button" onClick={() => setForm(null)}>Cancel</button>
        </form>
      ) : confirmDelete ? (
        <span style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}>
          Delete “{active?.name}” and its {active?.count ?? 0} changes?
          <button className="btn" onClick={() => { cs.scenarios.remove(cs.scenarios.active); setConfirmDelete(false); }}>Delete</button>
          <button className="btn ghost" onClick={() => setConfirmDelete(false)}>Keep</button>
        </span>
      ) : (
        <select id="scenario" aria-label="Scenario" value={cs.scenarios.active} onChange={e => onSelect(e.target.value)} disabled={githubOnly}>
          {cs.scenarios.list.map(s => <option key={s.id} value={s.id}>{s.name}{s.count ? ` (${s.count})` : ""}</option>)}
          <option disabled>──────</option>
          <option value="__new">New empty scenario…</option>
          <option value="__copy">Duplicate this scenario…</option>
          <option value="__rename">Rename…</option>
          <option value="__delete">Delete this scenario…</option>
        </select>
      )}
      <button className="iconbtn" onClick={cs.undo} disabled={!cs.canUndo || githubOnly} title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
      <button className="iconbtn" onClick={cs.redo} disabled={!cs.canRedo || githubOnly} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</button>
      {count > 0 && !githubOnly && <a className="pill count" href={reviewHref} title="Review these changes and apply them to GitHub">{count} change{count === 1 ? "" : "s"} · Review</a>}
      <label className="check-row" style={{ fontSize: 12 }} title="Hide your changes and show the project exactly as GitHub has it">
        <input id="github-only" type="checkbox" checked={githubOnly} onChange={e => setGithubOnly(e.target.checked)} /> GitHub only
      </label>
    </div>
  );
}
