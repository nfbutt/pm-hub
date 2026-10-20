// "Can this plan work?" — what is broken in the plan as written, and what a model on
// this computer spotted. Every suggestion is checked before it is shown, and nothing is
// applied without a click.
import type { Op } from "../../model/ops";
import type { Plan } from "../../model/plan/cpm";
import type { LinkSuggestion, ReleaseSuggestion } from "../../model/plan/infer";
import type { PlanStatus } from "../usePlanSuggestions";
import { PlanProblems } from "./PlanProblems";

export interface PlanCheckProps {
  plan: Plan;
  links: LinkSuggestion[];
  releases: ReleaseSuggestion[];
  status: PlanStatus;
  /** How many proposals were thrown out by the checks. */
  dropped: number;
  /** The suggestions the user has already turned down. */
  dismissed: Set<string>;
  /** Accept a suggestion: record the change. */
  onAccept: (ops: Op[], label: string) => void;
  /** Turn a suggestion down, without a fuss. */
  onDismiss: (id: string) => void;
  /** Point the map or the chart at something. */
  onFocus: (keys: string[]) => void;
  readOnly: boolean;
}

export function PlanCheck({ plan, links, releases, status, dropped, dismissed, onAccept, onDismiss, onFocus, readOnly }: PlanCheckProps) {
  const shownLinks = links.filter(l => !dismissed.has(l.id));
  const shownReleases = releases.filter(r => !dismissed.has(r.id));

  return (
    <>
      <PlanProblems plan={plan} onFocus={onFocus} />

      {(shownLinks.length > 0 || shownReleases.length > 0 || status === "on") && (
        <section className="card pad">
          <h3>What the model spotted</h3>
          {status === "working" && <p className="muted">Asking the model on this computer…</p>}
          {status === "unreachable" && <p className="muted">The model on this computer did not answer. The checks above come from the plan itself.</p>}
          {status === "off" && <p className="muted">Turn on a local model in Settings to have it read the plan for you.</p>}

          {shownLinks.map(l => (
            <div key={l.id} className="plan-sugg">
              <div className="plan-sugg-title"><b>{l.toTitle}</b> waits for <b>{l.fromTitle}</b></div>
              <div className="muted plan-quote">“{l.evidence}”<span className="muted"> — from {l.evidenceIn}</span></div>
              {!readOnly && (
                <div className="emap-card-actions">
                  <button className="btn small" onClick={() => onAccept(l.ops, `Linked ${l.toTitle} after ${l.fromTitle}`)}>Accept</button>
                  <button className="btn small ghost" onClick={() => onDismiss(l.id)}>Not this</button>
                </div>
              )}
            </div>
          ))}

          {shownReleases.map(r => (
            <div key={r.id} className="plan-sugg">
              <div className="plan-sugg-title">Move {r.titles.join(", ")} into <b>{r.release}</b></div>
              {r.why && <div className="muted">{r.why}</div>}
              {!readOnly && (
                <div className="emap-card-actions">
                  <button className="btn small" onClick={() => onAccept(r.ops, `Moved ${r.titles.length} epics into ${r.release}`)}>Accept</button>
                  <button className="btn small ghost" onClick={() => onDismiss(r.id)}>Not this</button>
                </div>
              )}
            </div>
          ))}

          {status === "on" && shownLinks.length === 0 && shownReleases.length === 0 && (
            <p className="muted">Nothing the model said passed the checks.
              {dropped > 0 && <> {dropped} proposal{dropped === 1 ? "" : "s"} {dropped === 1 ? "was" : "were"} dropped: they pointed at items that are not in the project, closed a loop, or could not be checked.</>}
            </p>
          )}
          {dropped > 0 && shownLinks.length + shownReleases.length > 0 && (
            <p className="muted">{dropped} other proposal{dropped === 1 ? "" : "s"} {dropped === 1 ? "was" : "were"} dropped by the checks.</p>
          )}
        </section>
      )}
    </>
  );
}
