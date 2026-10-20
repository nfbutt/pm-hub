import { useEffect, useState } from "react";
import { emptyDraft } from "../model/schedule";
import { shiftDates } from "../model/edits";
import { CommandMenu } from "../ui/CommandMenu";
import { Plan } from "./Plan";
import { Review } from "./Review";
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
import { EpicMap } from "./EpicMap";
import { Roadmap } from "./Roadmap";
import { Overview } from "./Overview";
import { Progress } from "./Progress";
import { Schedule } from "./Schedule";
import { Workload } from "./Workload";
import { Releases } from "./Releases";
import { Settings } from "./Settings";
import { Changes } from "./Changes";
import { HistorySettings } from "./HistorySettings";
import { useHistory } from "./useHistory";
import type { Baseline } from "../model/diff";
import { useChangeSet } from "./useChangeSet";
import { useProject, type Source } from "./useProject";

/** Views that exist so far, in tab order. Later phases add to this list. */
const TABS: { id: ViewId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "gantt", label: "Gantt" },
  { id: "plan", label: "Plan" },
  { id: "releases", label: "Releases" },
  { id: "schedule", label: "Schedule" },
  { id: "progress", label: "Progress" },
  { id: "workload", label: "Status & workload" },
  { id: "burnup", label: "Burn-up" },
  { id: "confidence", label: "Release confidence" },
  { id: "dependencies", label: "Dependencies" },
  { id: "epics", label: "Epic Map" },
  { id: "roadmap", label: "Roadmap" },
  { id: "changes", label: "What changed" },
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const history = useHistory(owner, number, source.kind === "github" ? source.client : null);
  const [compare, setCompare] = useState<{ id: string; baseline: Baseline } | null>(null);
  const compareTo = (id: string | null, b?: Baseline | null) => {
    if (!id) { setCompare(null); return; }
    if (b) { setCompare({ id, baseline: b }); return; }
    history.readBaseline(id).then(baseline => setCompare({ id, baseline }), () => setCompare(null));
  };
  // Views see the project as edited, unless "GitHub only" is on. Editing waits until saved changes have loaded.
  const shown = !githubOnly && cs.applied ? cs.applied.project : project;
  const draft = !githubOnly && cs.applied ? cs.applied.local : emptyDraft();
  const editor = !githubOnly && cs.ready && cs.editor ? cs.editor : undefined;

  // Keyboard: Ctrl/Cmd+K command menu, Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) undo and redo,
  // [ and ] shift the selection a week, Esc clears it. Ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "k") { e.preventDefault(); setMenuOpen(o => !o); return; }
      const el = e.target as HTMLElement | null;
      if (menuOpen || (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))) return;
      if (e.ctrlKey || e.metaKey) {
        if (githubOnly) return;
        if (k === "z" && !e.shiftKey) { e.preventDefault(); cs.undo(); }
        else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); cs.redo(); }
        return;
      }
      if (k === "escape" && selected.size && !document.querySelector(".drawer")) { setSelected(new Set()); return; }
      if ((e.key === "[" || e.key === "]") && selected.size && editor && cs.applied) {
        e.preventDefault();
        const days = e.key === "]" ? 7 : -7;
        editor.record(`Shifted ${selected.size} item${selected.size > 1 ? "s" : ""} ${days > 0 ? "a week later" : "a week earlier"}`, shiftDates(cs.applied.project, mapping!, [...selected], days));
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [cs, githubOnly, menuOpen, selected, editor, mapping]);
  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);
  const setPrefs = (p: Prefs) => { setPrefsState(p); writePrefs(p); };

  const routeFor = (v: ViewId): Route =>
    source.kind === "demo" ? { kind: "demo", view: v } : { kind: "project", owner: source.owner, number: source.number, view: v };
  const active = view === "review" || TABS.some(t => t.id === view) ? view : "overview";

  const crumb = (
    <>
      <span>/</span>
      <b>{project?.title ?? (source.kind === "github" ? `${source.owner} #${source.number}` : "Demo")}</b>
      {source.kind === "demo" && <span className="pill accent">Demo data</span>}
    </>
  );
  const right = (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {project && cs.ready && <ChangeBar cs={cs} githubOnly={githubOnly} setGithubOnly={setGithubOnly} reviewHref={hrefFor(routeFor("review"))} />}
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
        {cs.ready && !cs.persistent && (
          <div className="callout warn">This browser's storage isn't responding, so your changes won't be kept after you close this tab. Review and apply them before leaving.</div>
        )}
        {!project && !error && <p className="muted">{progress ? `Loading items ${progress.loaded} of ${progress.total}…` : "Loading the project…"}</p>}
        {shown && mapping && (
          <>
            {active === "overview" && <Overview project={shown} mapping={mapping} />}
            {active === "gantt" && <Gantt project={shown} mapping={mapping} draft={draft} editor={editor} changed={githubOnly ? 0 : cs.net.length} onDiscardAll={editor ? cs.clear : undefined} prefs={prefs} setPrefs={setPrefs} selected={selected} onSelect={setSelected}
              baselines={history.baselines} compare={compare} onCompare={id => compareTo(id)} />}
            {active === "plan" && <Plan project={shown} mapping={mapping} draft={draft} editor={editor} selected={selected} onSelect={setSelected} />}
            {active === "releases" && <Releases project={shown} mapping={mapping} draft={draft} />}
            {active === "schedule" && <Schedule project={shown} mapping={mapping} draft={draft} />}
            {active === "progress" && <Progress project={shown} mapping={mapping} draft={draft} />}
            {active === "workload" && <Workload project={shown} mapping={mapping} draft={draft} />}
            {active === "burnup" && <BurnUp project={shown} mapping={mapping} />}
            {active === "confidence" && <Confidence project={shown} mapping={mapping} />}
            {active === "dependencies" && <Dependencies project={shown} mapping={mapping} draft={draft} />}
            {active === "epics" && <EpicMap project={shown} mapping={mapping} draft={draft} editor={editor} local={prefs.local}
              history={history} reviewHref={hrefFor(routeFor("review"))} />}
            {active === "roadmap" && <Roadmap project={shown} mapping={mapping} draft={draft} editor={editor} local={prefs.local}
              zoom={prefs.zoom} today={new Date().toISOString().slice(0, 10)} />}
            {active === "changes" && project && (
              <Changes base={project} edited={shown} mapping={mapping} history={history} compareId={compare?.id ?? null}
                onCompare={(id, b) => { compareTo(id, b); if (id) location.hash = hrefFor(routeFor("gantt")); }} settingsHref={hrefFor(routeFor("settings"))} />
            )}
            {active === "review" && project && cs.editor && (
              <Review key={cs.scenarios.active} base={project} net={cs.net} titleOf={cs.editor.titleOf} client={source.kind === "github" ? source.client : null}
                onApplied={slots => cs.removeSlots(slots)} onRecord={(label, ops) => cs.editor!.record(label, ops)} refresh={state.refresh}
                mapping={mapping} history={history} scenario={cs.scenarios.list.find(s => s.id === cs.scenarios.active)?.name ?? "Default"}
                goBack={() => { location.hash = hrefFor(routeFor("gantt")); }} />
            )}
            {active === "settings" && project && <Settings project={project} mapping={mapping} setMapping={state.setMapping} resetMapping={state.resetMapping} prefs={prefs} setPrefs={setPrefs}
              extra={<HistorySettings history={history} owner={owner} number={number} canShare={source.kind === "github"}
                repos={[...new Set(project.items.map(i => i.repo).filter((r): r is string => !!r))].sort()} />} />}
          </>
        )}
        <UndoToast action={cs.lastAction} onUndo={cs.undo} canUndo={cs.canUndo && !githubOnly} />
        {menuOpen && shown && mapping && (
          <CommandMenu project={shown} mapping={mapping} editor={editor} selected={selected} onSelect={setSelected}
            views={TABS} go={v => { location.hash = hrefFor(routeFor(v as ViewId)); }}
            undo={cs.undo} redo={cs.redo} toggleGithubOnly={() => setGithubOnly(g => !g)} onClose={() => setMenuOpen(false)} />
        )}
      </main>
    </>
  );
}
