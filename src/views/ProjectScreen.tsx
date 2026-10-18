import { useEffect, useState } from "react";
import { emptyDraft } from "../model/schedule";
import { ChangeBar } from "../ui/ChangeBar";
import { UndoToast } from "../ui/Toast";
import { hrefFor, type Route, type ViewId } from "../router";
import { readPrefs, writePrefs, type Prefs } from "../store/cache";
import { TopBar } from "../ui/TopBar";
import { UserMenu } from "../ui/UserMenu";
import { DEMO_OWNER } from "../demo/fixture";
import { Gantt } from "./Gantt";
import { BurnUp } from "./BurnUp";
import { Confidence } from "./Confidence";
import { Dependencies } from "./Dependencies";
import { Overview } from "./Overview";
import { Progress } from "./Progress";
import { Schedule } from "./Schedule";
import { Workload } from "./Workload";
import { Releases } from "./Releases";
import { Settings } from "./Settings";
import { useChangeSet } from "./useChangeSet";
import { useProject, type Source } from "./useProject";

/** Views that exist so far, in tab order. Later phases add to this list. */
const TABS: { id: ViewId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "gantt", label: "Gantt" },
  { id: "releases", label: "Releases" },
  { id: "schedule", label: "Schedule" },
  { id: "progress", label: "Progress" },
  { id: "workload", label: "Status & workload" },
  { id: "burnup", label: "Burn-up" },
  { id: "confidence", label: "Release confidence" },
  { id: "dependencies", label: "Dependencies" },
  { id: "settings", label: "Settings" },
];

export function ProjectScreen({ source, view, onSignOut }: { source: Source; view: ViewId; onSignOut?: () => void }) {
  const state = useProject(source);
  const { project, mapping, loading, progress, error, errorKind } = state;
  const rate = source.kind === "github" ? source.client.state.rateLimit : null;
  const owner = source.kind === "github" ? source.owner : DEMO_OWNER;
  const number = source.kind === "github" ? source.number : 1;
  const cs = useChangeSet(owner, number, project, mapping);
  const [githubOnly, setGithubOnly] = useState(false);
  // Views see the project as edited, unless "GitHub only" is on. Editing waits until saved changes have loaded.
  const shown = !githubOnly && cs.applied ? cs.applied.project : project;
  const draft = !githubOnly && cs.applied ? cs.applied.local : emptyDraft();
  const editor = !githubOnly && cs.ready && cs.editor ? cs.editor : undefined;

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y), except while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (!(e.ctrlKey || e.metaKey) || githubOnly) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); cs.undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); cs.redo(); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [cs, githubOnly]);
  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);
  const setPrefs = (p: Prefs) => { setPrefsState(p); writePrefs(p); };

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
      {project && cs.ready && <ChangeBar cs={cs} githubOnly={githubOnly} setGithubOnly={setGithubOnly} />}
      {source.kind === "github" && (
        <>
          {rate && rate.remaining < 500 && (
            <span className="pill warn" title={`Resets at ${new Date(rate.resetAt).toLocaleTimeString()}`}>{rate.remaining} API points left this hour</span>
          )}
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
        {error && (
          <div className="callout bad" role="alert" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span>{error} {project && "Showing the last loaded copy."}</span>
            {errorKind === "auth" && onSignOut && <button className="btn" onClick={onSignOut}>Connect a new token</button>}
            {errorKind === "not-found" && <a className="btn" href="#/">Choose another project</a>}
          </div>
        )}
        {!project && !error && <p className="muted">{progress ? `Loading items ${progress.loaded} of ${progress.total}…` : "Loading the project…"}</p>}
        {shown && mapping && (
          <>
            {active === "overview" && <Overview project={shown} mapping={mapping} />}
            {active === "gantt" && <Gantt project={shown} mapping={mapping} draft={draft} editor={editor} changed={githubOnly ? 0 : cs.net.length} onDiscardAll={editor ? cs.clear : undefined} prefs={prefs} setPrefs={setPrefs} />}
            {active === "releases" && <Releases project={shown} mapping={mapping} draft={draft} />}
            {active === "schedule" && <Schedule project={shown} mapping={mapping} draft={draft} />}
            {active === "progress" && <Progress project={shown} mapping={mapping} draft={draft} />}
            {active === "workload" && <Workload project={shown} mapping={mapping} draft={draft} />}
            {active === "burnup" && <BurnUp project={shown} mapping={mapping} />}
            {active === "confidence" && <Confidence project={shown} mapping={mapping} />}
            {active === "dependencies" && <Dependencies project={shown} mapping={mapping} draft={draft} />}
            {active === "settings" && project && <Settings project={project} mapping={mapping} setMapping={state.setMapping} resetMapping={state.resetMapping} prefs={prefs} setPrefs={setPrefs} />}
          </>
        )}
        <UndoToast action={cs.lastAction} onUndo={cs.undo} canUndo={cs.canUndo && !githubOnly} />
      </main>
    </>
  );
}
