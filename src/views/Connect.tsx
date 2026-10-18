import { useState, type FormEvent } from "react";
import { createClient, GitHubError, missingScopes } from "../github/client";
import { loadViewerProjects } from "../github/load";
import { saveToken } from "../store/token";
import { TopBar } from "../ui/TopBar";

const NEW_TOKEN_URL = "https://github.com/settings/tokens/new?scopes=project,repo,read:org&description=pm-hub";

export function Connect({ onConnected }: { onConnected: (token: string) => void }) {
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<{ token: string; missing: string[] } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = token.trim();
    if (!t) return;
    setBusy(true); setError(null); setWarning(null);
    try {
      const client = createClient(t);
      await loadViewerProjects(client);
      const missing = missingScopes(client.state.scopes);
      if (missing.length) { setWarning({ token: t, missing }); return; }
      saveToken(t, remember);
      onConnected(t);
    } catch (err) {
      setError(err instanceof GitHubError ? err.message : "Something went wrong while checking the token.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar right={<a className="btn" href="#/demo/overview">Try the demo</a>} />
      <main className="page narrow">
        <div style={{ display: "grid", gap: 8, marginTop: 24 }}>
          <span className="eyebrow">Connect to GitHub</span>
          <h1 style={{ fontSize: 28, fontWeight: 800 }}>Roadmaps and forecasts for your GitHub Projects</h1>
          <p className="muted" style={{ maxWidth: "62ch" }}>
            pm-hub reads a GitHub Project and draws its roadmap, Gantt chart, release forecasts and dependency graph.
            It runs entirely in your browser: your token is sent only to api.github.com, and nothing is stored on a server.
          </p>
        </div>

        <form className="card pad" onSubmit={submit} style={{ display: "grid", gap: 12 }}>
          <label htmlFor="token" style={{ fontWeight: 700 }}>Personal access token</label>
          <input id="token" className="input" type="password" autoComplete="off" spellCheck={false}
            placeholder="ghp_…" value={token} onChange={e => setToken(e.target.value)} />
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input id="remember" type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
            Remember on this device. Otherwise it's forgotten when you close the tab.
          </label>
          {error && <div className="callout bad" role="alert">{error}</div>}
          {warning && (
            <div className="callout warn" role="alert" style={{ display: "grid", gap: 8 }}>
              <span>This token is missing <b>{warning.missing.join(", ")}</b>. Some projects or issues may not load.</span>
              <span>
                <button type="button" className="btn" onClick={() => { saveToken(warning.token, remember); onConnected(warning.token); }}>
                  Continue anyway
                </button>
              </span>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn primary" type="submit" disabled={busy || !token.trim()}>{busy ? "Checking…" : "Connect"}</button>
            <a className="btn" href={NEW_TOKEN_URL} target="_blank" rel="noopener noreferrer">Create a token on GitHub ↗</a>
          </div>
        </form>

        <section className="card pad" style={{ display: "grid", gap: 8 }}>
          <h2 style={{ fontSize: 15, fontWeight: 800 }}>Which token?</h2>
          <p>
            Use a <b>classic</b> token with <code>project</code> and <code>repo</code> (add <code>read:org</code> for organization
            projects). The link above pre-selects those scopes. pm-hub only writes to GitHub when you review your changes and press Apply.
            A token with just <code>read:project</code> works too: you can plan freely, but not apply.
          </p>
          <p className="muted">
            If you only work with public repositories, <code>public_repo</code> can replace <code>repo</code>.
          </p>
        </section>
      </main>
    </>
  );
}
