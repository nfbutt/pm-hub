import { useEffect, useMemo, useState } from "react";
import { churnAcross, diffBaselines, scopeAddedAfterStart, snapshot, type Baseline, type BaselineDiff } from "../model/diff";
import type { Mapping } from "../model/mapping";
import type { Project } from "../model/normalize";
import { buildSchedule } from "../model/schedule";
import type { HistoryState } from "./useHistory";

const fmt = (d: string | null) => (d ? new Date(d.length > 10 ? d : d + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "none");
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

interface Props {
  /** The project as GitHub has it. */
  base: Project;
  /** The project with your pending changes. */
  edited: Project;
  mapping: Mapping;
  history: HistoryState;
  compareId: string | null;
  onCompare: (id: string | null, b: Baseline | null) => void;
  settingsHref: string;
}

export function Changes({ base, edited, mapping, history, compareId, onCompare, settingsHref }: Props) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [withDraft, setWithDraft] = useState(false);
  const [selected, setSelected] = useState<string | null>(compareId);
  const [before, setBefore] = useState<Baseline | null>(null);
  const [churnSet, setChurnSet] = useState<Baseline[]>([]);
  const current = withDraft ? edited : base;
  const nowSnap = useMemo(() => snapshot(current, mapping, buildSchedule(current, mapping), "now"), [current, mapping]);
  const diff: BaselineDiff | null = useMemo(() => (before ? diffBaselines(before, nowSnap) : null), [before, nowSnap]);
  const scope = useMemo(() => scopeAddedAfterStart(base, mapping, buildSchedule(base, mapping)), [base, mapping]);

  // Default to the most recent baseline; load the last ten for churn.
  useEffect(() => { if (!selected && history.baselines[0]) setSelected(history.baselines[0].id); }, [history.baselines, selected]);
  useEffect(() => {
    if (!selected) { setBefore(null); return; }
    history.readBaseline(selected).then(setBefore, () => setBefore(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  useEffect(() => {
    Promise.all(history.baselines.slice(0, 10).map(b => history.readBaseline(b.id).catch(() => null)))
      .then(list => setChurnSet(list.filter((b): b is Baseline => !!b)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.baselines]);
  const churn = useMemo(() => churnAcross([...churnSet, snapshot(base, mapping, buildSchedule(base, mapping), "now")]), [churnSet, base, mapping]);

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const b = snapshot(base, mapping, buildSchedule(base, mapping), name.trim() || `Baseline ${new Date().toLocaleDateString()}`);
      await history.saveBaseline(b);
      setName(""); setMsg(`Saved “${b.name}”.`);
    } catch (e) { setMsg(e instanceof Error ? `Couldn't save: ${e.message}` : "Couldn't save the baseline."); }
    finally { setSaving(false); }
  }

  const where = history.config.mode === "github" ? <>Shared in <b>{history.config.repo}</b> under <code>{history.config.dir}</code></> : <>Saved in this browser only. <a href={settingsHref}>Share it through a GitHub repo</a> so your team sees the same history.</>;
  const slips = diff?.moved.filter(m => (m.days ?? 0) > 0) ?? [];
  const pulled = diff?.moved.filter(m => (m.days ?? 0) < 0) ?? [];

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 1100 }}>
      <div className="section-h">
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>What changed</h1>
          <p className="muted" style={{ maxWidth: "80ch" }}>A baseline is a snapshot of the plan. Save one at each review (and pm-hub saves one before every apply), then see what moved since. {where}</p>
        </div>
      </div>
      {history.error && <div className="callout bad">{history.error}</div>}

      <section className="card pad" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input id="bl-name" className="input" style={{ maxWidth: 300, fontFamily: "var(--f-body)" }} placeholder="Baseline name, e.g. Q1 plan" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save baseline of GitHub now"}</button>
        {msg && <span className="muted" style={{ fontSize: 13 }}>{msg}</span>}
      </section>

      <section className="card pad" style={{ display: "grid", gap: 12 }}>
        <div className="section-h" style={{ marginBottom: 0 }}>
          <h2>Since a baseline</h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select id="bl-pick" className="cell-select" style={{ borderColor: "var(--line)", maxWidth: 320 }} aria-label="Baseline" value={selected ?? ""} onChange={e => setSelected(e.target.value || null)}>
              {!history.baselines.length && <option value="">No baselines yet</option>}
              {history.baselines.map(b => <option key={b.id} value={b.id}>{b.name} · {when(b.savedAt)}{b.auto ? " (auto)" : ""}</option>)}
            </select>
            <label className="check-row"><input type="checkbox" checked={withDraft} onChange={e => setWithDraft(e.target.checked)} /> Include my unapplied changes</label>
            {before && <button className="btn" onClick={() => onCompare(compareId === selected ? null : selected, compareId === selected ? null : before)}>{compareId === selected ? "Stop comparing on the Gantt" : "Compare on the Gantt"}</button>}
          </div>
        </div>
        {!before ? <p className="muted">{history.loading ? "Loading…" : "Save a baseline to start tracking how the plan moves."}</p> : diff && (
          <>
            <div className="stats">
              {([["Added", diff.added.length], ["Removed", diff.removed.length], ["Slipped", slips.length], ["Pulled in", pulled.length], ["Moved between epics", diff.reparented.length], ["Closed", diff.closed.length]] as const).map(([l, v]) => (
                <div key={l} className="card stat"><span className="v">{v}</span><span className="l">{l}</span></div>
              ))}
            </div>
            {diff.moved.length > 0 && (
              <div className="tablewrap"><table className="t">
                <thead><tr><th>Item</th><th>End date then</th><th>Now</th><th>Change</th></tr></thead>
                <tbody>{diff.moved.slice(0, 40).map(mv => (
                  <tr key={mv.key}><td>{mv.epic && <span className="pill accent" style={{ marginRight: 6 }}>Epic</span>}{mv.title}</td><td className="num">{fmt(mv.fromEnd)}</td><td className="num">{fmt(mv.toEnd)}</td>
                    <td className="num" style={{ color: (mv.days ?? 0) > 0 ? "var(--bad)" : "var(--good)", fontWeight: 700 }}>{mv.days === null ? (mv.toEnd ? "dated" : "undated") : `${mv.days > 0 ? "+" : ""}${mv.days} days`}</td></tr>
                ))}</tbody>
              </table></div>
            )}
            <div className="grid2">
              {diff.added.length > 0 && <List title="Added" items={diff.added.map(i => i.title)} />}
              {diff.removed.length > 0 && <List title="Removed" items={diff.removed.map(i => i.title)} />}
              {diff.reparented.length > 0 && <List title="Moved between epics" items={diff.reparented.map(r => `${r.item.title}: ${title(nowSnap, before, r.from)} → ${title(nowSnap, before, r.to)}`)} />}
              {diff.releaseChanged.length > 0 && <List title="Release changed" items={diff.releaseChanged.map(r => `${r.item.title}: ${r.from ?? "none"} → ${r.to ?? "none"}`)} />}
              {diff.renamed.length > 0 && <List title="Renamed" items={diff.renamed.map(r => `“${r.from}” → “${r.item.title}”`)} />}
            </div>
          </>
        )}
      </section>

      <div className="grid2">
        <section className="card pad">
          <div className="section-h"><h2>Epics that keep slipping</h2><span className="muted" style={{ fontSize: 12 }}>Across the last {churnSet.length} baselines and today</span></div>
          {!churn.length ? <p className="muted">No epic's end date has moved across the saved baselines.</p> : (
            <table className="t"><thead><tr><th>Epic</th><th>Moves</th><th>Net slip</th><th>First → latest end</th></tr></thead>
              <tbody>{churn.slice(0, 15).map(c => (
                <tr key={c.key}><td>{c.title}</td><td className="num">{c.endMoves}×</td><td className="num" style={{ color: c.slipDays > 0 ? "var(--bad)" : "var(--good)", fontWeight: 700 }}>{c.slipDays > 0 ? "+" : ""}{c.slipDays} d</td><td className="num">{fmt(c.firstEnd)} → {fmt(c.lastEnd)}</td></tr>
              ))}</tbody></table>
          )}
        </section>
        <section className="card pad">
          <div className="section-h"><h2>Scope added after start</h2></div>
          {!scope.size ? <p className="muted">No epic has gained stories after it started.</p> : (
            <table className="t"><tbody>{[...scope.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <tr key={k}><td>{base.items.find(i => i.key === k)?.title}</td><td className="num"><span className="pill warn">+{n} since start</span></td></tr>
            ))}</tbody></table>
          )}
        </section>
      </div>

      <section className="card pad">
        <div className="section-h"><h2>Applied changes</h2><span className="muted" style={{ fontSize: 12 }}>Most recent first</span></div>
        {!history.changes.length ? <p className="muted">Nothing applied from pm-hub yet.</p> : (
          <div style={{ display: "grid", gap: 10 }}>
            {history.changes.map(c => {
              const ok = c.steps.filter(s => s.status === "applied").length, bad = c.steps.filter(s => s.status === "failed").length;
              return (
                <details key={c.at} className="feed">
                  <summary><b>{when(c.at)}</b> · {c.author ?? "someone"} applied {ok} change{ok === 1 ? "" : "s"}{bad ? `, ${bad} failed` : ""}{c.scenario !== "Default" ? ` from “${c.scenario}”` : ""}</summary>
                  <ul>{c.steps.map((s, i) => <li key={i}><span className={s.status === "applied" ? "pill good" : s.status === "failed" ? "pill bad" : "pill"}>{s.status}</span> {s.label}{s.reason && <em className="muted"> · why: {s.reason}</em>}{s.message && s.status === "failed" && <span className="muted"> · {s.message}</span>}</li>)}</ul>
                </details>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function title(now: Baseline, before: Baseline, key: string | null) {
  if (!key) return "no epic";
  return now.items.find(i => i.key === key)?.title ?? before.items.find(i => i.key === key)?.title ?? key;
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div><h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)", marginBottom: 6 }}>{title} ({items.length})</h3>
      <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 3, fontSize: 13 }}>{items.slice(0, 25).map((t, i) => <li key={i}>{t}</li>)}</ul></div>
  );
}
