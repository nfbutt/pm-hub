import { useEffect, useMemo, useRef, useState } from "react";
import {
  archivedIds, buildSteps, checkStep, endSlip, execute, fetchCurrent, fetchRepoMeta, involvedKeys, postStatusUpdate, recheck,
  type Call, type RepoMeta, type Step,
} from "../github/apply";
import { writeAccess, type GitHubClient } from "../github/client";
import type { Item, Project } from "../model/normalize";
import { remapKeys, slotOf, type Op } from "../model/ops";
import { rollbackOps } from "../model/rollback";
import { Modal } from "../ui/Drawer";
import { snapshot } from "../model/diff";
import type { Mapping } from "../model/mapping";
import { buildSchedule } from "../model/schedule";
import type { HistoryState } from "./useHistory";

type Phase = "checking" | "ready" | "applying" | "done";
const STATUS: Record<Step["status"], [string, string]> = {
  ready: ["pill", "Ready"], local: ["pill", "Stays in pm-hub"], conflict: ["pill bad", "Changed on GitHub"], already: ["pill good", "Already on GitHub"],
  applying: ["pill accent", "Applying…"], applied: ["pill good", "Applied"], failed: ["pill bad", "Failed"], skipped: ["pill", "Skipped"],
};

interface Props {
  base: Project;
  /** The pending changes, grouped by the change they came from. */
  groups: { id: string; label: string; ops: Op[] }[];
  titleOf: (key: string) => string;
  client: GitHubClient | null;
  /** Called after an apply with the slots to drop from the draft and the ops that would undo it. */
  onApplied: (doneSlots: Set<string>, revert: Op[]) => void;
  /** Records ops as a new change (used for "Revert this apply"). */
  onRecord: (label: string, ops: Op[]) => void;
  refresh: () => void;
  goBack: () => void;
  mapping: Mapping;
  /** Where to record a baseline before, and a change file after, each apply. */
  history?: HistoryState;
  scenario: string;
}

export function Review({ base, groups, titleOf, client, onApplied, onRecord, refresh, goBack, mapping, history, scenario }: Props) {
  const ops = useMemo(() => groups.flatMap(g => g.ops), [groups]);
  const [histNote, setHistNote] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("checking");
  // The changes are shown straight away; the check against GitHub fills in their status.
  const [steps, setSteps] = useState<Step[]>(() => buildSteps(ops, titleOf));
  const [error, setError] = useState<string | null>(null);
  const [dry, setDry] = useState<Call[] | null>(null);
  const [revertOps, setRevertOps] = useState<Op[]>([]);
  const [status, setStatus] = useState<{ post: boolean; value: "ON_TRACK" | "AT_RISK" | "OFF_TRACK"; body: string }>({ post: false, value: "ON_TRACK", body: "" });
  const ctx = useRef<{ current: Map<string, Item>; repos: Map<string, RepoMeta> }>({ current: new Map(), repos: new Map() });
  const access = client ? writeAccess(client.state.scopes) : "no";

  // Check every change against what GitHub has right now.
  async function check() {
    setPhase("checking"); setError(null);
    const fresh = buildSteps(ops, titleOf);
    if (!client) { setSteps(fresh); setPhase("ready"); return; }
    try {
      const current = await fetchCurrent(client, base, involvedKeys(ops), archivedIds(ops));
      const repoNames = new Set<string>();
      for (const op of ops) {
        if (op.kind === "create" && op.item.repo) repoNames.add(op.item.repo);
        if (op.kind === "milestone") repoNames.add(op.repo);
        if (op.kind === "setLabels" || op.kind === "setMilestone" || op.kind === "setAssignees") { const r = (current.get(op.key) ?? base.items.find(i => i.key === op.key))?.repo; if (r) repoNames.add(r); }
      }
      const repos = new Map<string, RepoMeta>();
      for (const r of repoNames) repos.set(r, await fetchRepoMeta(client, r));
      ctx.current = { current, repos };
      for (const s of fresh) {
        if (s.status !== "ready") continue;
        const c = checkStep(s.op, "key" in s.op ? current.get(s.op.key) : undefined);
        s.status = c.status; s.message = c.theirs;
        if (c.status === "conflict") s.include = false;
      }
      setSteps(fresh); setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The check against GitHub failed."); setSteps(fresh); setPhase("ready");
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void check(); }, []);

  const patch = (id: string, p: Partial<Step>) => setSteps(ss => ss.map(s => (s.id === id ? { ...s, ...p } : s)));
  const writable = steps.filter(s => s.status !== "local");
  const toApply = writable.filter(s => s.include && (s.status === "ready" || s.status === "conflict" || s.status === "failed"));
  // The steps, split back into the changes they came from: a change of forty items is
  // one group, not forty.
  const stepGroups = useMemo(() => {
    let at = 0;
    return groups.map(g => { const ss = steps.slice(at, at + g.ops.length); at += g.ops.length; return { ...g, steps: ss }; });
  }, [groups, steps]);

  /** Puts the pending changes up for the team rather than writing them. */
  async function propose() {
    if (!history) return;
    setHistNote(null);
    try {
      await history.saveProposal({
        version: 1, at: new Date().toISOString(), author: history.author,
        name: `${ops.length} change${ops.length === 1 ? "" : "s"}`,
        note: "Put up from the review screen.",
        ops,
      });
      setHistNote("Your proposal is in the shared plan history. Anyone with the folder can pick it up and review it.");
    } catch (e) {
      setHistNote(`The proposal could not be saved: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  async function apply(dryRun: boolean) {
    if (!client) return;
    const run = steps.map(s => ({ ...s, status: s.include && s.status === "conflict" ? "ready" as const : s.status }));
    if (dryRun) {
      const res = await execute(client, base, run.map(s => ({ ...s })), ctx.current.current, ctx.current.repos, { dryRun: true });
      setDry(res.calls); return;
    }
    setPhase("applying"); setSteps(run); setHistNote(null);
    // Re-read the items right before writing. The check happened a moment ago, and
    // someone may have changed something in between: their change is not overwritten.
    let fresh = run;
    let changed = 0;
    try {
      const current = await fetchCurrent(client, base, involvedKeys(ops), archivedIds(ops));
      const again = recheck(run, current);
      fresh = again.steps;
      changed = again.changed;
    } catch { /* if we cannot re-read, carry on with the check we already did */ }
    if (changed) setHistNote(`${changed} change${changed === 1 ? "" : "s"} ${changed === 1 ? "was" : "were"} made on GitHub while you were here, and ${changed === 1 ? "was" : "were"} left out. Check again to see them.`);
    // History never blocks an apply: a failed write is reported, not fatal.
    const notes: string[] = [];
    if (history) {
      try { await history.saveBaseline(snapshot(base, mapping, buildSchedule(base, mapping), "Before apply", true)); }
      catch (e) { notes.push(`the baseline before applying (${e instanceof Error ? e.message : "unknown error"})`); }
    }
    const res = await execute(client, base, fresh.filter(s => s.include), ctx.current.current, ctx.current.repos, { onStep: s => patch(s.id, { status: s.status, message: s.message }) });
    // Map draft keys of created items to their new GitHub keys, so the revert can find them.
    const keyMap = new Map<string, string>();
    for (const [k, c] of res.created) { const op = ops.find(o => o.kind === "create" && o.key === k) as Extract<Op, { kind: "create" }> | undefined; if (op?.item.repo) keyMap.set(k, `${op.item.repo}#${c.number}`); }
    const applied = res.steps.filter(s => s.status === "applied");
    const done = new Set(applied.map(s => slotOf(s.op)));
    // The ids GitHub knows the items by, so a rollback can address an item that is only
    // out of the project.
    const ids: Record<string, { item: string; content: string }> = {};
    for (const [k, item] of ctx.current.current) ids[k] = { item: item.id, content: item.ids.content ?? "" };
    for (const [k, c] of res.created) { const real = keyMap.get(k); if (real) ids[real] = { item: c.itemId, content: c.contentId }; }
    const revert = rollbackOps({ ops: applied.filter(s => s.message !== "Already like this on GitHub.").map(s => s.op), keys: Object.fromEntries(keyMap), ids });
    setRevertOps(revert);
    if (status.post && applied.length) {
      try { await postStatusUpdate(client, base.id, status.value, status.body || summary(applied)); } catch { /* reported below */ }
    }
    if (history) {
      try {
        // The operations and the ids are kept with the record: GitHub has no undo, so
        // this is the only way back to what the plan looked like.
        await history.saveChange({
          version: 1, at: new Date().toISOString(), author: history.author, scenario,
          steps: res.steps.filter(s => s.status !== "local").map(s => ({
            label: s.label, status: s.status, kind: s.op.kind, ...("key" in s.op ? { key: s.op.key } : {}),
            ...(s.message ? { message: s.message } : {}), ...(s.reason ? { reason: s.reason } : {}),
          })),
          ops: applied.map(s => remapKeys(s.op, keyMap)),
          ids,
        });
      } catch (e) { notes.push(`the change record (${e instanceof Error ? e.message : "unknown error"})`); }
      if (notes.length) setHistNote(`Your changes were applied, but pm-hub couldn't save ${notes.join(" or ")} to the plan history.`);
    }
    setSteps([...res.steps]);
    setPhase("done");
    onApplied(done, revert);
    refresh();
  }

  const applied = steps.filter(s => s.status === "applied").length, failed = steps.filter(s => s.status === "failed").length;

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 980 }}>
      <div className="section-h">
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Review changes</h1>
          <p className="muted" style={{ maxWidth: "75ch" }}>
            Untick anything you don't want to send. pm-hub first checks each change against what GitHub has right now; anything someone else
            changed in the meantime is flagged and left out unless you choose to overwrite it.
          </p>
        </div>
        <button className="btn ghost" onClick={goBack}>← Back to editing</button>
      </div>

      {!client && <div className="callout info">This is demo data, so nothing can be written. Use <b>Dry run</b> to see exactly what would be sent.</div>}
      {client && access === "no" && <div className="callout warn">This token can only read. To apply changes, create a token with the <b>project</b> and <b>repo</b> scopes, then sign in again.</div>}
      {error && <div className="callout bad">{error} <button className="btn" onClick={() => void check()}>Check again</button></div>}
      {phase === "checking" && <p className="muted" aria-live="polite">Checking {ops.length} change{ops.length === 1 ? "" : "s"} against GitHub…</p>}
      {ops.length === 0 && phase === "ready" && steps.length === 0 && <div className="card pad"><p>No changes to review.</p></div>}

      {stepGroups.length > 0 && (
        <section className="card review">
          {stepGroups.map(g => (
            <div key={g.id} className="rv-group">
              <h3>{g.label} <span className="muted">{g.steps.length} change{g.steps.length === 1 ? "" : "s"}</span></h3>
              {g.steps.map(s => {
                const slip = endSlip(s.op);
                const [cls, label] = STATUS[s.status];
                return (
                  <div key={s.id} className={`rv-step ${s.include ? "" : "off"}`}>
                    <input type="checkbox" aria-label={`Include: ${s.label}`} checked={s.include} disabled={s.status === "local" || phase !== "ready"}
                      onChange={e => patch(s.id, { include: e.target.checked })} />
                    <div className="rv-body">
                      <span>{s.label}</span>
                      {s.status === "conflict" && (
                        <span className="rv-note">GitHub now has: {s.message}. {s.include ? "Your change will overwrite it." : "Tick to overwrite it with yours, or "}
                          {!s.include && phase === "ready" && <button className="linkbtn" onClick={() => { onApplied(new Set([slotOf(s.op)]), []); setSteps(ss => ss.filter(x => x.id !== s.id)); }}>use GitHub's version</button>}
                        </span>
                      )}
                      {s.status === "failed" && <span className="rv-note bad">{s.message}</span>}
                      {s.status === "applied" && s.message && <span className="rv-note">{s.message}</span>}
                      {Math.abs(slip) > 3 && phase === "ready" && s.include && (
                        <input className="input rv-reason" placeholder={`Why did the target ${slip > 0 ? "slip" : "move up"} ${Math.abs(slip)} days? (optional, posted as a comment)`}
                          aria-label="Reason for the date change" value={s.reason ?? ""} onChange={e => patch(s.id, { reason: e.target.value })} />
                      )}
                    </div>
                    <span className={cls}>{label}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      )}

      {phase === "ready" && toApply.length > 0 && client && (
        <section className="card pad" style={{ display: "grid", gap: 8 }}>
          <label className="check-row"><input type="checkbox" checked={status.post} onChange={e => setStatus({ ...status, post: e.target.checked })} />
            Also post a project status update on GitHub</label>
          {status.post && (
            <>
              <select className="cell-select" style={{ maxWidth: 200, borderColor: "var(--line)" }} aria-label="Project status" value={status.value}
                onChange={e => setStatus({ ...status, value: e.target.value as typeof status.value })}>
                <option value="ON_TRACK">On track</option><option value="AT_RISK">At risk</option><option value="OFF_TRACK">Off track</option>
              </select>
              <textarea className="input" rows={3} aria-label="Status update text" style={{ fontFamily: "var(--f-body)" }}
                placeholder={summary(toApply)} value={status.body} onChange={e => setStatus({ ...status, body: e.target.value })} />
            </>
          )}
        </section>
      )}

      {phase === "ready" && ops.length > 0 && history?.config.mode === "github" && (
        <div className="callout info" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span>Share these changes with your team instead of applying them?</span>
          <button className="btn" onClick={() => void propose()}>Put up a proposal</button>
          <span className="muted" style={{ fontSize: 12 }}>It goes into the shared plan history, and whoever picks it up reviews it before anything is written.</span>
        </div>
      )}

      {phase === "ready" && ops.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn primary" disabled={!client || access === "no" || toApply.length === 0} onClick={() => void apply(false)}>
            Apply {toApply.length} change{toApply.length === 1 ? "" : "s"} to GitHub
          </button>
          <button className="btn" disabled={toApply.length === 0} onClick={() => void (client ? apply(true) : setDry(dryCalls(toApply)))}>Dry run</button>
          <button className="btn ghost" onClick={() => void check()}>Check again</button>
          {steps.some(s => s.status === "local") && <span className="muted" style={{ fontSize: 12 }}>Parking and lane order stay in pm-hub; GitHub has no place for them.</span>}
        </div>
      )}
      {phase === "applying" && <p className="muted">Applying… keep this tab open.</p>}
      {phase === "done" && (
        <div className={`callout ${failed ? "warn" : "info"}`} role="status" aria-live="polite" style={{ display: "grid", gap: 8 }}>
          <b>{applied} applied{failed ? `, ${failed} failed` : ""}.</b>
          {histNote && <span>{histNote}</span>}
          <span>{failed ? "Failed changes stay in your draft so you can fix and retry them." : "Your draft now holds only what wasn't sent."} The project is refreshing from GitHub.</span>
          <div style={{ display: "flex", gap: 8 }}>
            {revertOps.length > 0 && (
              <>
                <button className="btn" onClick={() => { onRecord(`Revert of the apply at ${new Date().toLocaleTimeString()}`, revertOps); setRevertOps([]); }}>Prepare a revert of this apply</button>
                <span className="muted" style={{ fontSize: 12 }}>GitHub cannot undo a creation, so any issue this created is closed and taken out of the project. It stays in the repository, closed.</span>
              </>
            )}
            <button className="btn primary" onClick={goBack}>Done</button>
          </div>
        </div>
      )}

      {dry && (
        <Modal title={`Dry run: ${dry.length} GitHub call${dry.length === 1 ? "" : "s"}`} onClose={() => setDry(null)}>
          <p className="muted">Nothing was sent. These are the exact writes Apply would make.</p>
          <pre className="dry">{dry.map(c => `${c.name}(${JSON.stringify(c.vars)})`).join("\n")}</pre>
        </Modal>
      )}
    </div>
  );
}

/** Without a client (demo), a dry run can still show which writes each change needs. */
function dryCalls(steps: Step[]): Call[] {
  return steps.map(s => ({ doc: "", name: s.op.kind, vars: { change: s.label } }));
}

function summary(steps: Step[]): string {
  return `Plan update from pm-hub: ${steps.length} change${steps.length === 1 ? "" : "s"}.\n` + steps.slice(0, 12).map(s => `- ${s.label}`).join("\n") + (steps.length > 12 ? `\n- …and ${steps.length - 12} more` : "");
}
