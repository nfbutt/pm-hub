// The card that comes up over the Epic Map: an epic's or a task's whole title — the map
// cuts names short, and hides them when zoomed out — and, for a task, the way to its issue.
// It waits a moment before it changes or goes, so the pointer can move onto it and click.
import { useEffect, useRef, useState } from "react";
import type { EpicMapModel } from "../../model/epicmap";
import type { Item } from "../../model/normalize";
import type { Peek } from "./canvas";

/** How long a card stays after the pointer leaves, so it can be reached. */
const LINGER_MS = 280;

/** What the canvas reports, turned into the card that is shown. */
export function usePeek() {
  const [peek, setPeek] = useState<Peek | null>(null);
  const shown = useRef<Peek | null>(null);
  const onCard = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = (p: Peek | null) => { shown.current = p; setPeek(p); };

  // A new card or none: straight away when nothing is showing, after a moment when one is,
  // so moving from a task towards its card doesn't swap it for the epic underneath.
  const report = (p: Peek | null, now = false) => {
    clearTimeout(timer.current);
    if (now) { onCard.current = false; show(null); return; }
    if (onCard.current) return;
    if (!shown.current || (p && p.key === shown.current.key)) { show(p); return; }
    timer.current = setTimeout(() => { if (!onCard.current) show(p); }, LINGER_MS);
  };
  const enter = () => { onCard.current = true; clearTimeout(timer.current); };
  const leave = () => { onCard.current = false; timer.current = setTimeout(() => show(null), LINGER_MS); };
  useEffect(() => () => clearTimeout(timer.current), []);
  return { peek, report, enter, leave, close: () => report(null, true) };
}

export function PeekCard({ peek, model, byKey, width, onOpen, onEnter, onLeave }: {
  peek: Peek;
  model: EpicMapModel;
  byKey: Map<string, Item>;
  /** The canvas width, to keep the card inside it. */
  width: number;
  onOpen: (key: string) => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const item = byKey.get(peek.key);
  const half = 150;
  const left = Math.max(half + 8, Math.min(width - half - 8, peek.x));
  // Above the epic when there is room; at the top of the map when there is not.
  const above = peek.kind === "epic" && peek.y > 90;

  let body: JSX.Element | null = null;
  if (peek.kind === "epic") {
    const e = model.epics.find(x => x.key === peek.key);
    if (!e) return null;
    body = (
      <>
        <b className="emap-peek-title">{e.title}</b>
        <span className="muted">
          {e.taskKeys.length} task{e.taskKeys.length === 1 ? "" : "s"}{e.health !== null ? ` · health ${e.health}` : ""}
        </span>
      </>
    );
  } else {
    const t = model.tasks.find(x => x.key === peek.key);
    if (!t) return null;
    const epic = t.epicKey ? model.epics.find(x => x.key === t.epicKey)?.title ?? null : null;
    const better = t.misfit && t.best ? model.epics.find(x => x.key === t.best!.epicKey)?.title ?? null : null;
    body = (
      <>
        <b className="emap-peek-title">{t.title}</b>
        <span className="muted">
          {item?.number ? `#${item.number} · ` : ""}{t.state === "open" ? "Open" : "Done"} · {epic ? <>in {epic}</> : "in no epic"}
        </span>
        {better && <span className="emap-peek-note">Reads more like {better}</span>}
      </>
    );
  }

  return (
    <div className={`emap-peek ${peek.kind} ${above ? "above" : ""}`} style={{ left, top: above ? peek.y : Math.max(8, peek.y) }} role="tooltip"
      onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {body}
      <span className="emap-peek-links">
        {item?.url && <a href={item.url} target="_blank" rel="noopener noreferrer">Open on GitHub ↗</a>}
        <button className="linkbtn" onClick={() => onOpen(peek.key)}>Details</button>
      </span>
    </div>
  );
}
