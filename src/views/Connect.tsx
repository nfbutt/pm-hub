import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient, GitHubError, missingScopes } from "../github/client";
import { loadViewerProjects } from "../github/load";
import { saveToken } from "../store/token";
import { TopBar } from "../ui/TopBar";
import { ThemeToggle } from "../ui/Theme";

const NEW_TOKEN_URL = "https://github.com/settings/tokens/new?scopes=project,repo,read:org&description=pm-hub";
const SCOPES = ["project", "repo", "read:org"];

/** What GitHub's tokens look like, so a paste of the wrong thing is caught before a request. */
const looksLikeToken = (t: string) => /^(ghp_|github_pat_|gho_|ghu_)[A-Za-z0-9_]{20,}$/.test(t);

export function Connect({ onConnected, rejected = false, target = null }: {
  onConnected: (token: string) => void;
  /** GitHub turned the saved token down: it expired or was revoked. */
  rejected?: boolean;
  /** The project the link was for, so the page can say where the person is going. */
  target?: { owner: string; number: number } | null;
}) {
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<{ token: string; missing: string[] } | null>(null);
  const [opened, setOpened] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Back from GitHub with a token on the clipboard: the box to paste it in is ready.
  useEffect(() => {
    if (!opened) return;
    const onFocus = () => input.current?.focus();
    addEventListener("focus", onFocus);
    return () => removeEventListener("focus", onFocus);
  }, [opened]);

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
      setError(err instanceof GitHubError
        ? err.kind === "auth" ? "GitHub doesn't accept this token. Check it was copied whole, or create a new one." : err.message
        : "Something went wrong while checking the token.");
    } finally {
      setBusy(false);
    }
  }

  const trimmed = token.trim();
  const pasted = trimmed.length > 0;
  const odd = pasted && !looksLikeToken(trimmed);

  return (
    <>
      <TopBar right={<><ThemeToggle /><a className="btn" href="#/demo/overview">Try the demo</a></>} />
      <main className="connect">
        <div className="connect-intro">
          {target && <span className="target">Opening <b>{target.owner}</b> · project #{target.number}</span>}
          <h1>{target ? "Connect GitHub to open this project" : "Roadmaps and forecasts for your GitHub Projects"}</h1>
          <p className="lede">
            pm-hub reads a GitHub Project and draws its roadmap, Gantt chart, release forecasts and dependencies. It runs in
            your browser: the token goes only to api.github.com, and nothing is stored on a server.
          </p>
          <Sketch />
          <p className="muted" style={{ fontSize: 13 }}>
            Not ready to connect? <a href="#/demo/overview">Look around the demo project</a> first.
          </p>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {rejected && (
            <div className="callout warn" role="alert">
              <b>GitHub no longer accepts the token saved here.</b> It has expired or been revoked. Create a new one below to carry on.
            </div>
          )}
          <form className="card connect-steps" onSubmit={submit}>
            <section className={`cstep ${pasted ? "done" : "now"}`}>
              <span className="cstep-n" aria-hidden="true">1</span>
              <div className="cstep-body">
                <h2>{rejected ? "Create a new token on GitHub" : "Create a token on GitHub"}</h2>
                <p className="muted">
                  {opened
                    ? "Pick an expiry, press Generate token at the bottom of the page, then copy the token. GitHub only shows it once."
                    : "GitHub opens in a new tab with the permissions pm-hub needs already ticked:"}
                </p>
                {!opened && <div className="scopes">{SCOPES.map(s => <code key={s}>{s}</code>)}</div>}
                <span>
                  <a className={`btn ${pasted ? "" : "primary"}`} href={NEW_TOKEN_URL} target="_blank" rel="noopener noreferrer"
                    onClick={() => setOpened(true)}>
                    {opened ? "Open GitHub again ↗" : "Create a token on GitHub ↗"}
                  </a>
                </span>
              </div>
            </section>

            <section className={`cstep ${pasted ? "now" : ""}`}>
              <span className="cstep-n" aria-hidden="true">2</span>
              <div className="cstep-body">
                <h2><label htmlFor="token">Paste it here</label></h2>
                <input id="token" ref={input} className="input" type="password" autoComplete="off" spellCheck={false}
                  placeholder="ghp_… or github_pat_…" value={token} onChange={e => setToken(e.target.value)} />
                {odd && <span className="muted" style={{ fontSize: 12 }}>That doesn't look like a GitHub token. They start with <code>ghp_</code> or <code>github_pat_</code>.</span>}
                <label className="check-row">
                  <input id="remember" type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
                  Remember on this device. Otherwise it's forgotten when you close the tab.
                </label>
                {error && <div className="callout bad" role="alert">{error}</div>}
                {warning && (
                  <div className="callout warn" role="alert" style={{ display: "grid", gap: 8 }}>
                    <span>This token is missing <b>{warning.missing.join(", ")}</b>. Some projects or issues may not load.</span>
                    <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn" onClick={() => { saveToken(warning.token, remember); onConnected(warning.token); }}>
                        Continue anyway
                      </button>
                      <a className="btn ghost" href={NEW_TOKEN_URL} target="_blank" rel="noopener noreferrer">Create one with every scope ↗</a>
                    </span>
                  </div>
                )}
                <span>
                  <button className={`btn ${pasted ? "primary" : ""}`} type="submit" disabled={busy || !pasted}>
                    {busy ? "Checking…" : target ? "Connect and open the project" : "Connect"}
                  </button>
                </span>
              </div>
            </section>
          </form>

          <details className="card pad">
            <summary>Which token, and why those permissions?</summary>
            <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
              <p>
                A <b>classic</b> token with <code>project</code> and <code>repo</code>, plus <code>read:org</code> for organization
                projects. pm-hub only writes to GitHub when you review your changes and press Apply.
              </p>
              <p>
                A token with just <code>read:project</code> works too: you can plan freely, but not apply. If you only work with public
                repositories, <code>public_repo</code> can replace <code>repo</code>.
              </p>
              <p className="muted">When the token expires, pm-hub brings you back here to make a new one.</p>
            </div>
          </details>
        </div>
      </main>
    </>
  );
}

/**
 * A plan in miniature, drawn in the app's own colours: three lanes of work, one item
 * waiting on another, and the amber line for today.
 */
function Sketch() {
  const bars: { lane: number; x: number; w: number; c: string; done: number }[] = [
    { lane: 0, x: 18, w: 150, c: "var(--lane-1)", done: .8 },
    { lane: 0, x: 188, w: 110, c: "var(--lane-1)", done: .2 },
    { lane: 1, x: 70, w: 170, c: "var(--lane-2)", done: .55 },
    { lane: 2, x: 140, w: 90, c: "var(--lane-3)", done: .35 },
    { lane: 2, x: 252, w: 120, c: "var(--lane-3)", done: 0 },
  ];
  const y = (lane: number) => 22 + lane * 40;
  return (
    <svg className="sketch card" viewBox="0 0 400 150" role="img" aria-label="A small timeline: three lanes of work with today marked">
      {[80, 160, 240, 320].map(x => <line key={x} x1={x} x2={x} y1={8} y2={142} stroke="var(--line-soft)" />)}
      <path d={`M 240 ${y(1) + 10} C 250 ${y(1) + 10}, 244 ${y(2) + 10}, 252 ${y(2) + 10}`} fill="none" stroke="var(--muted)" strokeWidth={1.2} strokeDasharray="3 3" />
      {bars.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={y(b.lane)} width={b.w} height={20} rx={5} fill={`color-mix(in srgb, ${b.c} 16%, var(--surface))`} stroke={b.c} strokeWidth={1.2} />
          {b.done > 0 && <rect x={b.x} y={y(b.lane)} width={b.w * b.done} height={20} rx={5} fill={`color-mix(in srgb, ${b.c} 38%, var(--surface))`} />}
        </g>
      ))}
      <line x1={206} x2={206} y1={6} y2={144} stroke="var(--today)" strokeWidth={2} />
      <circle cx={206} cy={6} r={3.5} fill="var(--today)" />
    </svg>
  );
}
