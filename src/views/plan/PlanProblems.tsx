// What is broken in the plan as written: the parts that cannot happen as they stand.
// The same card is used by the Epic Map and the Roadmap, so a problem is described the
// same way wherever it is seen.
import type { Plan, PlanProblem } from "../../model/plan/cpm";

const KIND_LABEL: Record<PlanProblem["kind"], string> = {
  cycle: "Loop", early: "Wrong order", late: "Too late", external: "Outside the project",
  undated: "No dates", norelease: "No release",
};

export function PlanProblems({ plan, onFocus }: { plan: Plan; onFocus?: (keys: string[]) => void }) {
  const problems = plan.problems.filter(p => p.severity > 1);
  const minor = plan.problems.filter(p => p.severity === 1);
  // Three at a time: a list nobody reads is a list nobody acts on.
  const shown = problems.slice(0, 3);
  if (!problems.length && !minor.length) {
    return (
      <section className="card pad">
        <h3>Can this plan work?</h3>
        <p className="muted">Nothing is broken: every epic that blocks another starts after it, and the plan fits its releases.</p>
      </section>
    );
  }
  return (
    <section className="card pad">
      <h3>Can this plan work?</h3>
      {problems.length === 0 ? (
        <p className="muted">Nothing is broken. {minor.length} thing{minor.length === 1 ? "" : "s"} worth knowing about.</p>
      ) : (
        <>
          <ul className="emap-list plan-problems">
            {shown.map((p, i) => (
              <li key={`${p.kind}-${i}`}>
                <span className={`pill ${p.severity === 3 ? "bad" : "warn"}`}>{KIND_LABEL[p.kind]}</span>
                {onFocus ? (
                  <button className="emap-link" onClick={() => onFocus(p.keys)}>{p.message}</button>
                ) : (
                  <span>{p.message}</span>
                )}
                <div className="muted">{p.remedy}</div>
              </li>
            ))}
          </ul>
          {problems.length > shown.length && <p className="muted">and {problems.length - shown.length} more.</p>}
        </>
      )}
    </section>
  );
}
