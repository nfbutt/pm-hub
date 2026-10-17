import { useMemo } from "react";
import { forecastInputs, releaseForecasts, weeksUntil, type ReleaseForecast } from "../model/forecast";
import type { Mapping } from "../model/mapping";
import type { Project } from "../model/normalize";

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function band(chance: number | null): [string, string] {
  if (chance === null) return ["pill", "No forecast"];
  if (chance >= 0.85) return ["pill good", "Likely"];
  if (chance >= 0.5) return ["pill warn", "Coin flip"];
  return ["pill bad", "Unlikely"];
}

export function Confidence({ project, mapping }: { project: Project; mapping: Mapping }) {
  const inputs = useMemo(() => forecastInputs(project, mapping, today()), [project, mapping]);
  const rows = useMemo(() => releaseForecasts(project, mapping, today(), inputs), [project, mapping, inputs]);

  if (mapping.release.kind === "none") return <div className="card pad"><p>No releases are set up for this project. Pick milestones or an iteration field in Settings.</p></div>;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 4 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800 }}>Release confidence</h1>
        <p className="muted" style={{ maxWidth: "80ch" }}>
          For each release, pm-hub replays your last 12 weeks of throughput 10,000 times in random order and counts how often the open work
          finishes by the due date. A release also has to absorb the open work of every release due before it, because the same team
          does that work first.
        </p>
      </div>

      <div className="card pad" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <span className="eyebrow">Weekly throughput used</span>
        <span className="num" style={{ letterSpacing: ".05em" }}>{inputs.samples.join(" · ")}</span>
        <span className="muted" style={{ fontSize: 12 }}>{inputs.closedInHistory} items closed in 12 weeks</span>
        {inputs.thin && <span className="pill warn">Thin history: treat as rough</span>}
      </div>

      {rows.length === 0 ? <div className="card pad"><p className="muted">No work items are assigned to a release.</p></div> : (
        <div className="conf-grid">
          {rows.map(r => <ReleaseCard key={r.id} r={r} />)}
        </div>
      )}
    </div>
  );
}

function ReleaseCard({ r }: { r: ReleaseForecast }) {
  const [cls, label] = r.open === 0 ? ["pill good", "Done"] : band(r.chance);
  const pct = r.chance === null ? null : Math.round(r.chance * 100);
  const dueWeek = r.due ? weeksUntil(today(), r.due) : null;
  const hist = r.mc?.histogram ?? [];
  const lastNonZero = hist.reduce((acc, v, i) => (v > 0 ? i : acc), 0);
  const shown = hist.slice(0, Math.max(lastNonZero + 1, (dueWeek ?? 0) + 1, 4));
  const peak = Math.max(1, ...shown);
  return (
    <section className="card pad conf">
      <div className="section-h" style={{ marginBottom: 4 }}>
        <h2>{r.title}</h2>
        <span className={cls}>{label}</span>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>{r.due ? `Due ${fmt(r.due)}` : "No due date"} · {r.open} of {r.total} open{r.cumulativeOpen > r.open && ` · ${r.cumulativeOpen} including earlier releases`}</div>
      {r.open > 0 && (
        <>
          <div className="conf-big"><span className="num">{pct === null ? "—" : `${pct}%`}</span><span className="muted">chance of finishing by the due date</span></div>
          {r.mc ? (
            <>
              <div className="hist" role="img" aria-label="Distribution of finish weeks">
                {shown.map((v, i) => (
                  <span key={i} className={dueWeek !== null && i <= dueWeek ? "in" : "out"} style={{ height: `${(100 * v) / peak}%` }} title={`${v} of ${r.mc!.runs} runs finish in week ${i}`} />
                ))}
              </div>
              <div className="muted" style={{ fontSize: 11, display: "flex", justifyContent: "space-between" }}><span>This week</span><span>Week {shown.length - 1}</span></div>
              <div className="conf-dates">
                <span><b className="num">{r.p50Date ? fmt(r.p50Date) : "—"}</b><span className="muted">Half the runs finish by</span></span>
                <span><b className="num">{r.p85Date ? fmt(r.p85Date) : "—"}</b><span className="muted">85% finish by</span></span>
              </div>
              {r.mc.unfinished > 0 && <p className="muted" style={{ fontSize: 12 }}>{Math.round((100 * r.mc.unfinished) / r.mc.runs)}% of runs hadn't finished after two years.</p>}
            </>
          ) : <p className="callout warn">Nothing was closed in the last 12 weeks, so there's no pace to forecast from.</p>}
        </>
      )}
    </section>
  );
}
