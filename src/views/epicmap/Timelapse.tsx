// The timelapse: how the shape of the plan changed over time. Every baseline in the plan
// history is run through the same analysis, so the score over time is the score the map
// shows today.
import { useEffect, useMemo, useRef, useState } from "react";
import { LineChart } from "../../ui/charts";
import { baselineMapping, baselineProject } from "../../model/epicmap/baseline";
import { analyze, type EpicMapModel } from "../../model/epicmap";
import type { Mapping } from "../../model/mapping";
import type { Project } from "../../model/normalize";
import type { HistoryState } from "../useHistory";

interface Frame {
  id: string;
  name: string;
  savedAt: string;
  score: number | null;
  model: EpicMapModel;
}

export function Timelapse({ project, mapping, history, current, show }: {
  project: Project;
  mapping: Mapping;
  history: HistoryState;
  /** The map as it is now, the last frame. */
  current: EpicMapModel;
  /** Show a frame on the map. */
  show: (m: EpicMapModel) => void;
}) {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [at, setAt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const metas = useMemo(() => [...history.baselines].sort((a, b) => a.savedAt.localeCompare(b.savedAt)), [history.baselines]);
  // The baselines are read when there are new ones, not every time the plan changes:
  // running the analysis over forty baselines on every edit would be slow.
  const latest = useRef({ project, mapping, history });
  latest.current = { project, mapping, history };

  useEffect(() => {
    if (!metas.length) { setFrames([]); return; }
    let dead = false;
    setLoading(true);
    setFailed(false);
    (async () => {
      const { project: p, mapping: m, history: h } = latest.current;
      const loaded: Frame[] = [];
      for (const meta of metas) {
        try {
          const baseline = await h.readBaseline(meta.id);
          const model = analyze(baselineProject(p, baseline), baselineMapping(m), { openOnly: false });
          loaded.push({ id: meta.id, name: meta.name, savedAt: meta.savedAt, score: model.score, model });
        } catch { /* a baseline that cannot be read is simply left out */ }
      }
      if (dead) return;
      setFrames(loaded);
      setFailed(loaded.length < metas.length);
      setLoading(false);
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metas]);

  // The plan as it is now is the last frame of the line.
  const all = useMemo(() => [...frames, {
    id: "now", name: "Now", savedAt: new Date().toISOString(), score: current.score, model: current,
  }], [frames, current]);

  if (!frames.length) {
    return (
      <section className="card pad">
        <h3>Timelapse</h3>
        <p className="muted">{loading ? "Reading the plan history…" : "Save a baseline to see how the plan has changed over time."}</p>
      </section>
    );
  }

  const frame = all[Math.min(at, all.length - 1)]!;
  const dates = all.map(f => f.savedAt.slice(0, 10));
  const scores = all.map(f => f.score);

  return (
    <section className="card pad emap-timelapse">
      <h3>Timelapse</h3>
      <LineChart x={dates} series={[{ name: "Structure score", color: "var(--accent)", values: scores }]}
        height={120} label="Structure score over time" />
      <input className="emap-slider" type="range" min={0} max={all.length - 1} value={Math.min(at, all.length - 1)}
        onChange={e => { const i = Number(e.target.value); setAt(i); show(all[i]!.model); }}
        aria-label="Baseline" />
      <div className="emap-timelapse-row">
        <span className="muted">{frame.name} · {new Date(frame.savedAt).toLocaleDateString()}</span>
        <span className={`pill ${(frame.score ?? 0) >= 50 ? "good" : "warn"}`}>{frame.score ?? "—"}</span>
        <button className="btn small" onClick={() => { setAt(all.length - 1); show(current); }}>Back to now</button>
      </div>
      {failed && <p className="muted">Some baselines could not be read.</p>}
    </section>
  );
}
