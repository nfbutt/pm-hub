import { hrefFor, type Route, type ViewId } from "../router";
import { TopBar } from "../ui/TopBar";
import { UserMenu } from "../ui/UserMenu";
import { Overview } from "./Overview";
import { useProject, type Source } from "./useProject";

/** Views that exist so far, in tab order. Later phases add to this list. */
const TABS: { id: ViewId; label: string }[] = [
  { id: "overview", label: "Overview" },
];

export function ProjectScreen({ source, view, onSignOut }: { source: Source; view: ViewId; onSignOut?: () => void }) {
  const state = useProject(source);
  const { project, mapping, loading, progress, error } = state;
  const routeFor = (v: ViewId): Route =>
    source.kind === "demo" ? { kind: "demo", view: v } : { kind: "project", owner: source.owner, number: source.number, view: v };
  const active = TABS.some(t => t.id === view) ? view : "overview";

  const crumb = (
    <>
      <span>/</span>
      <b>{project?.title ?? (source.kind === "github" ? `${source.owner} #${source.number}` : "Demo")}</b>
      {source.kind === "demo" && <span className="pill accent">Demo data</span>}
    </>
  );
  const right = (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {source.kind === "github" && (
        <>
          {project && <span className="muted" style={{ fontSize: 12 }}>Loaded {new Date(project.loadedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
          <button className="btn" onClick={state.refresh} disabled={loading}>
            {loading ? (progress ? `Loading ${progress.loaded}/${progress.total}…` : "Loading…") : "Refresh"}
          </button>
        </>
      )}
      <a className="btn ghost" href="#/">Projects</a>
      <UserMenu onSignOut={onSignOut} />
    </div>
  );
  const tabs = (
    <nav className="tabs" aria-label="Views">
      {TABS.map(t => (
        <a key={t.id} className="tab" href={hrefFor(routeFor(t.id))} aria-current={t.id === active ? "page" : undefined}>{t.label}</a>
      ))}
    </nav>
  );

  return (
    <>
      <TopBar crumb={crumb} tabs={tabs} right={right} />
      <main className="page">
        {error && <div className="callout bad" role="alert">{error} {project && "Showing the last loaded copy."}</div>}
        {!project && !error && <p className="muted">{progress ? `Loading items ${progress.loaded} of ${progress.total}…` : "Loading the project…"}</p>}
        {project && mapping && active === "overview" && <Overview project={project} mapping={mapping} />}
      </main>
    </>
  );
}
