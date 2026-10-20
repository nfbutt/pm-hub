// The deck of suggestions beside the map: what to accept, reject or let wait.
import type { Suggestion } from "../../model/epicmap/suggest";

const KIND_LABEL: Record<Suggestion["kind"], string> = {
  move: "Move", merge: "Merge", split: "Split", gap: "New epic",
};

export interface SuggestionsProps {
  items: Suggestion[];
  /** Nothing is offered when there is nothing to offer. */
  onAccept: (s: Suggestion) => void;
  onReject: (s: Suggestion) => void;
  onSnooze: (s: Suggestion) => void;
  /** Called with the epics a card is about, so the map can show them. */
  onFocus: (s: Suggestion | null) => void;
  /** Read-only when the plan can't be changed. */
  readOnly: boolean;
  /** The card to point at, e.g. after clicking a gap bubble on the map. */
  highlight?: string | null;
}

export function Suggestions({ items, onAccept, onReject, onSnooze, onFocus, readOnly, highlight }: SuggestionsProps) {
  if (!items.length) return null;
  return (
    <section className="card pad">
      <h3>Suggestions</h3>
      <p className="muted emap-hint">Each one is a change you can accept, turn down or let wait a week.</p>
      <ul className="emap-cards">
        {items.map(s => (
          <li key={s.id} id={`emap-suggestion-${s.id}`}
            className={`emap-card ${highlight === s.id ? "lit" : ""}`}
            onMouseEnter={() => onFocus(s)} onMouseLeave={() => onFocus(null)}>
            <div className="emap-card-head">
              <span className="emap-kind">{KIND_LABEL[s.kind]}</span>
              {s.gain !== 0 && <span className={`emap-gain ${s.gain > 0 ? "up" : "down"}`}>{s.gain > 0 ? "+" : ""}{s.gain} score</span>}
            </div>
            <div className="emap-card-title">{s.title}</div>
            <div className="muted emap-card-why">{s.byModel ? "✦ " : ""}{s.why}</div>
            {readOnly ? (
              <div className="muted emap-card-why">Turn off “GitHub only” to act on this.</div>
            ) : (
              <div className="emap-card-actions">
                <button className="btn small" onClick={() => onAccept(s)}>Accept</button>
                <button className="btn small ghost" onClick={() => onReject(s)}>Reject</button>
                <button className="btn small ghost" onClick={() => onSnooze(s)}>Snooze</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
