import { useState } from "react";
import { defaultDir } from "../store/history";
import type { HistoryState } from "./useHistory";

/** Settings → History: keep plan history in this browser, or share it as files in a GitHub repo. */
export function HistorySettings({ history, owner, number, repos, canShare }: {
  history: HistoryState; owner: string; number: number; repos: string[]; canShare: boolean;
}) {
  const cfg = history.config;
  const [repo, setRepo] = useState(cfg.mode === "github" ? cfg.repo : repos[0] ?? "");
  const [dir, setDir] = useState(cfg.mode === "github" ? cfg.dir : defaultDir(owner, number));
  const valid = /^[\w.-]+\/[\w.-]+$/.test(repo.trim()) && dir.trim().length > 0 && !dir.includes("..");

  return (
    <section className="card pad settings">
      <h2>History</h2>
      <p className="muted" style={{ margin: 0 }}>
        Baselines and a record of every apply. pm-hub keeps them in this browser unless you share them through a repo, where they're saved
        as small JSON files that everyone using pm-hub on this project sees. Files are only ever added, never edited.
      </p>
      <label className="check-row"><input type="radio" name="h-mode" checked={cfg.mode === "local"} onChange={() => history.setConfig({ mode: "local" })} /> Only in this browser</label>
      <label className="check-row"><input type="radio" name="h-mode" disabled={!canShare} checked={cfg.mode === "github"}
        onChange={() => valid && history.setConfig({ mode: "github", repo: repo.trim(), dir: dir.trim().replace(/^\/+|\/+$/g, "") })} /> Shared in a GitHub repo
        {!canShare && <span className="muted"> (connect a GitHub token first)</span>}</label>
      {canShare && (
        <>
          <div className="setting">
            <label htmlFor="h-repo">Repository</label>
            <input id="h-repo" className="input" list="h-repos" placeholder="owner/repo" value={repo} onChange={e => setRepo(e.target.value)} />
            <datalist id="h-repos">{repos.map(r => <option key={r} value={r} />)}</datalist>
          </div>
          <div className="setting">
            <label htmlFor="h-dir">Folder</label>
            <input id="h-dir" className="input" value={dir} onChange={e => setDir(e.target.value)} />
            <span className="muted">Each commit is a new file in this folder. The token needs write access to the repo.</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn" disabled={!valid} onClick={() => history.setConfig({ mode: "github", repo: repo.trim(), dir: dir.trim().replace(/^\/+|\/+$/g, "") })}>
              {cfg.mode === "github" ? "Update" : "Share history here"}
            </button>
            {cfg.mode === "github" && <span className="muted" style={{ fontSize: 13 }}>Now shared in <b>{cfg.repo}</b> under <code>{cfg.dir}</code>.</span>}
          </div>
        </>
      )}
      {history.error && <div className="callout bad">{history.error}</div>}
    </section>
  );
}
