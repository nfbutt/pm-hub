// Meeting mode: one item at a time, on the map, with a tally of what the team decided.
// The map stays visible behind the panel, so "Next" can point at what it is talking about.
import { useEffect, useState } from "react";
import type { Suggestion } from "../../model/epicmap/suggest";

export interface AgendaItem {
  id: string;
  kind: "epic" | "suggestion";
  title: string;
  why: string;
  /** The epics to show on the map. */
  focus: string[];
  /** The suggestion to accept, when the item is one. */
  suggestion?: Suggestion;
}

/** What the team has done so far in this meeting. */
export interface MeetingTally { moves: number; merges: number; epics: number; score: number }

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function MeetingMode({ agenda, tally, onClose, onFocus, onAccept, reviewHref, readOnly }: {
  agenda: AgendaItem[];
  tally: MeetingTally;
  onClose: () => void;
  /** Show this item on the map. */
  onFocus: (item: AgendaItem) => void;
  onAccept: (s: Suggestion) => void;
  /** Where the Review tab is, for the summary at the end. */
  reviewHref: string;
  readOnly: boolean;
}) {
  const [at, setAt] = useState(0);
  const [timer, setTimer] = useState(true);
  const [left, setLeft] = useState<number | null>(null);
  const item = agenda[at];
  const finished = !item;

  useEffect(() => {
    if (!item) return;
    onFocus(item);
    setLeft(timer ? 180 : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, timer]);

  useEffect(() => {
    if (left === null || left <= 0) return;
    const t = setTimeout(() => setLeft(l => (l === null ? null : l - 1)), 1000);
    return () => clearTimeout(t);
  }, [left]);

  return (
    <div className="meeting" role="dialog" aria-label="Epic Map meeting">
      <div className="meeting-panel">
        <div className="meeting-head">
          <div>
            <div className="eyebrow">Epic Map meeting</div>
            <div className="muted">{finished ? "That's the agenda" : `Item ${at + 1} of ${agenda.length}`}</div>
          </div>
          <button className="btn" onClick={onClose}>Close</button>
        </div>

        {finished ? (
          <div className="card pad meeting-summary">
            <h3>What the team decided</h3>
            <ul className="emap-list">
              <li><b>{tally.moves}</b> task{tally.moves === 1 ? "" : "s"} moved</li>
              <li><b>{tally.merges}</b> epic{tally.merges === 1 ? "" : "s"} merged</li>
              <li><b>{tally.epics}</b> new epic{tally.epics === 1 ? "" : "s"}</li>
              <li><b>{tally.score >= 0 ? "+" : ""}{tally.score}</b> on the structure score</li>
            </ul>
            <p className="muted">Nothing is on GitHub yet. Check the changes, then apply them.</p>
            <a className="btn primary" href={reviewHref}>Go to Review</a>
          </div>
        ) : (
          <>
            <div className="card pad meeting-item">
              <span className="emap-kind">{item.kind === "epic" ? "Epic" : "Suggestion"}</span>
              <h3>{item.title}</h3>
              <p className="muted">{item.why}</p>
              {item.suggestion && !readOnly && (
                <div className="drow">
                  <button className="btn primary" onClick={() => onAccept(item.suggestion!)}>Accept</button>
                  <span className="muted">or skip to the next item</span>
                </div>
              )}
            </div>
            <div className="meeting-controls">
              <button className="btn" onClick={() => setAt(a => Math.max(0, a - 1))} disabled={at === 0}>Back</button>
              <button className="btn primary" onClick={() => setAt(a => Math.min(agenda.length, a + 1))}>
                {at === agenda.length - 1 ? "Finish" : "Next"}
              </button>
              <button className="btn ghost" onClick={() => setTimer(t => !t)}>{timer ? "Timer off" : "Timer on"}</button>
              {left !== null && <span className={`pill ${left < 30 ? "bad" : ""}`}>{clock(left)}</span>}
            </div>
            <div className="card pad meeting-tally">
              <span className="muted">So far</span>{" "}
              <b>{tally.moves}</b> moved · <b>{tally.merges}</b> merged · <b>{tally.epics}</b> new ·{" "}
              <b className={tally.score >= 0 ? "good" : "bad"}>{tally.score >= 0 ? "+" : ""}{tally.score}</b> score
            </div>
          </>
        )}
      </div>
    </div>
  );
}
