import { useEffect, useState } from "react";
import { GitHubError, type GitHubClient } from "../github/client";
import { loadViewerProjects, type Viewer } from "../github/load";
import type { ProjectSummary } from "../model/normalize";
import { hrefFor } from "../router";
import { TopBar } from "../ui/TopBar";
import { UserMenu } from "../ui/UserMenu";

export function ProjectPicker({ client, onSignOut, onTokenRejected }: { client: GitHubClient; onSignOut: () => void; onTokenRejected?: () => void }) {
  const [state, setState] = useState<{ viewer: Viewer; projects: ProjectSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  useEffect(() => {
    let live = true;
    loadViewerProjects(client)
      .then(r => live && setState(r))
      .catch(e => {
        if (!live) return;
        // A token GitHub no longer accepts is not an error to read: it is a new token to make.
        if (e instanceof GitHubError && e.kind === "auth" && onTokenRejected) { onTokenRejected(); return; }
        setError(e instanceof GitHubError ? e.message : "Couldn't load your projects.");
      });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const projects = state?.projects.filter(p => showClosed || !p.closed) ?? [];
  const owners = [...new Set(projects.map(p => p.owner))];

  return (
    <>
      <TopBar right={state && <UserMenu viewer={state.viewer} onSignOut={onSignOut} />} />
      <main className="page narrow">
        <div className="section-h" style={{ marginTop: 12 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>Choose a project</h1>
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
            <input id="show-closed" type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} /> Show closed
          </label>
        </div>
        {error && <div className="callout bad" role="alert">{error}</div>}
        {!state && !error && <p className="muted">Loading your projects…</p>}
        {state && projects.length === 0 && (
          <div className="card pad">
            <p>No projects found for <b>{state.viewer.login}</b>. Create one on GitHub, or <a href="#/demo/overview">open the demo project</a>.</p>
          </div>
        )}
        {owners.map(owner => (
          <section key={owner} style={{ display: "grid", gap: 8 }}>
            <span className="eyebrow">{owner}</span>
            <div className="card" style={{ overflow: "hidden" }}>
              {projects.filter(p => p.owner === owner).map((p, i) => (
                <a key={p.id} href={hrefFor({ kind: "project", owner: p.owner, number: p.number, view: "overview" })}
                  style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4, padding: "12px 16px", textDecoration: "none", color: "inherit",
                    borderTop: i ? "1px solid var(--line-soft)" : 0 }}>
                  <span style={{ fontWeight: 700 }}>{p.title} {p.closed && <span className="pill">Closed</span>}</span>
                  <span className="num muted">{p.itemCount} items</span>
                  {p.description && <span className="muted" style={{ gridColumn: "1 / -1", fontSize: 13 }}>{p.description}</span>}
                  <span className="muted" style={{ gridColumn: "1 / -1", fontSize: 12 }}>#{p.number} · updated {new Date(p.updatedAt).toLocaleDateString()}</span>
                </a>
              ))}
            </div>
          </section>
        ))}
        <p className="muted" style={{ fontSize: 13 }}>Want to look around first? <a href="#/demo/overview">Open the demo project</a>.</p>
      </main>
    </>
  );
}
