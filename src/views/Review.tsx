import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildSteps, checkStep, endSlip, execute, fetchCurrent, fetchRepoMeta, involvedKeys, postStatusUpdate, type Call, type RepoMeta, type Step,
} from "../github/apply";
import { writeAccess, type GitHubClient } from "../github/client";
import type { Item, Project } from "../model/normalize";
import { inverse, isNewKey, remapKeys, slotOf, type Op } from "../model/ops";
import { Modal } from "../ui/Drawer";

type Phase = "checking" | "ready" | "applying" | "done";
const STATUS: Record<Step["status"], [string, string]> = {
  ready: ["pill", "Ready"], local: ["pill", "Stays in pm-hub"], conflict: ["pill bad", "Changed on GitHub"], already: ["pill good", "Already on GitHub"],
  applying: ["pill accent", "Applying…"], applied: ["pill good", "Applied"], failed: ["pill bad", "Failed"], skipped: ["pill", "Skipped"],
};

interface Props {
  base: Project;
  net: Op[];
  titleOf: (key: string) => string;
  client: GitHubClient | null;
  /** Called after an apply with the slots to drop from the draft and the ops that would undo it. */
  onApplied: (doneSlots: Set<string>, revert: Op[]) => void;
  /** Records ops as a new change (used for "Revert this apply"). */
  onRecord: (label: string, ops: Op[]) => void;
  refresh: () => void;
  goBack: () => void;
}

export function Review({ base, net, titleOf, client, onApplied, onRecord, refresh, goBack }: Props) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dry, setDry] = useState<Call[] | null>(null);
  const [revertOps, setRevertOps] = useState<Op[]>([]);
  const [status, setStatus] = useState<{ post: boolean; value: "ON_TRACK" | "AT_RISK" | "OFF_TRACK"; body: string }>({ post: false, value: "ON_TRACK", body: "" });
  const ctx = useRef<{ current: Map<string, Item>; repos: Map<string, RepoMeta> }>({ current: new Map(), repos: new Map() });
  const access = client ? writeAccess(client.state.scopes) : "no";

  // Check every change against what GitHub has right now.
  async function check() {
    setPhase("checking"); setError(null);
    const fresh = buildSteps(net, titleOf);
    if (!client) { setSteps(fresh); setPhase("ready"); return; }
    try {
      const current = await fetchCurrent(client, base, involvedKeys(net));
      const repoNames = new Set<string>();
      for (const op of net) {
        if (op.kind === "create" && op.item.repo) repoNames.add(op.item.repo);
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
  const groups = useMemo(() => {
    const g = new Map<string, Step[]>();
    for (const s of steps) { const k = "key" in s.op ? s.op.key : `lane:${s.op.lane}`; if (!g.has(k)) g.set(k, []); g.get(k)!.push(s); }
    return [...g.entries()];
  }, [steps]);

  async function apply(dryRun: boolean) {
    if (!client) return;
    const run = steps.map(s => ({ ...s, status: s.include && s.status === "conflict" ? "ready" as const : s.status }));
    if (dryRun) {
      const res = await execute(client, base, run.map(s => ({ ...s })), ctx.current.current, ctx.current.repos, { dryRun: true });
      setDry(res.calls); return;
    }
    setPhase("applying"); setSteps(run);
    const res = await execute(client, base, run, ctx.current.current, ctx.current.repos, { onStep: s => patch(s.id, { status: s.status, message: s.message }) });
    // Map draft keys of created items to their new GitHub keys, so the revert can find them.
    const keyMap = new Map<string, string>();
    for (const [k, c] of res.created) { const op = net.find(o => o.kind === "create" && o.key === k) as Extract<Op, { kind: "create" }> | undefined; if (op?.item.repo) keyMap.set(k, `${op.item.repo}#${c.number}`); }
    const applied = res.steps.filter(s => s.status === "applied");
    const done = new Set(applied.map(s => slotOf(s.op)));
    const revert = applied.filter(s => s.message !== "Already like this on GitHub.").map(s => remapKeys(inverse(s.op), keyMap)).reverse();
    setRevertOps(revert);
    if (status.post && applied.length) {
      try { await postStatusUpdate(client, base.id, status.value, status.body || summary(applied)); } catch { /* reported below */ }
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
      {phase === "checking" && <p className="muted">Checking {net.length} change{net.length === 1 ? "" : "s"} against GitHub…</p>}
      {net.length === 0 && phase === "ready" && steps.length === 0 && <div className="card pad"><p>No changes to review.</p></div>}

      {phase !== "checking" && groups.length > 0 && (
        <section className="card review">
          {groups.map(([key, ss]) => (
            <div key={key} className="rv-group">
              <h3>{key.startsWith("lane:") ? `Order of ${key.slice(5)}` : titleOf(key)} {isNewKey(key) && <span className="pill accent">new</span>}</h3>
              {ss.map(s => {
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

      {phase === "ready" && net.length > 0 && (
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
        <div className={`callout ${failed ? "warn" : "info"}`} style={{ display: "grid", gap: 8 }}>
          <b>{applied} applied{failed ? `, ${failed} failed` : ""}.</b>
          <span>{failed ? "Failed changes stay in your draft so you can fix and retry them." : "Your draft now holds only what wasn't sent."} The project is refreshing from GitHub.</span>
          <div style={{ display: "flex", gap: 8 }}>
            {revertOps.length > 0 && <button className="btn" onClick={() => { onRecord(`Revert of the apply at ${new Date().toLocaleTimeString()}`, revertOps); setRevertOps([]); }}>Prepare a revert of this apply</button>}
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
