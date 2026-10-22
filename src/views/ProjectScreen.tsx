import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { buildSchedule, emptyDraft } from "../model/schedule";
import { setDatesWithDependents, shiftDates } from "../model/edits";
import { addDays } from "../model/mapping";
import { CommandMenu } from "../ui/CommandMenu";
import { Plan } from "./Plan";
import { ChangeBar } from "../ui/ChangeBar";
import { UndoToast } from "../ui/Toast";
import { hrefFor, type Route, type ViewId } from "../router";
import { readPrefs, writePrefs, type Prefs } from "../store/cache";
import { TopBar } from "../ui/TopBar";
import { DEMO_OWNER } from "../demo/fixture";
import { Gantt } from "./Gantt";
import { GlobalMic } from "./voice/GlobalMic";
import { ThemeToggle } from "../ui/Theme";
import { AiStatus } from "./ai/AiStatus";
import { say } from "../ai/voice";
import { useDictation } from "./voice/useDictation";
import { Overview } from "./Overview";
import { useHistory } from "./useHistory";
import type { Baseline } from "../model/diff";
import { useChangeSet } from "./useChangeSet";
import { useProject, type Source } from "./useProject";

// The views you land on (Overview, Gantt, Plan) come with the page; the rest load when
// first opened, so the first visit downloads a fraction of the app.
const Releases = lazy(() => import("./Releases").then(m => ({ default: m.Releases })));
const Schedule = lazy(() => import("./Schedule").then(m => ({ default: m.Schedule })));
const Progress = lazy(() => import("./Progress").then(m => ({ default: m.Progress })));
const Workload = lazy(() => import("./Workload").then(m => ({ default: m.Workload })));
const BurnUp = lazy(() => import("./BurnUp").then(m => ({ default: m.BurnUp })));
const Confidence = lazy(() => import("./Confidence").then(m => ({ default: m.Confidence })));
const Dependencies = lazy(() => import("./Dependencies").then(m => ({ default: m.Dependencies })));
const EpicMap = lazy(() => import("./EpicMap").then(m => ({ default: m.EpicMap })));
const Roadmap = lazy(() => import("./Roadmap").then(m => ({ default: m.Roadmap })));
const Planner = lazy(() => import("./Planner").then(m => ({ default: m.Planner })));
const Compare = lazy(() => import("./Compare").then(m => ({ default: m.Compare })));
const Changes = lazy(() => import("./Changes").then(m => ({ default: m.Changes })));
const Review = lazy(() => import("./Review").then(m => ({ default: m.Review })));
const Ai = lazy(() => import("./Ai").then(m => ({ default: m.Ai })));
const Settings = lazy(() => import("./Settings").then(m => ({ default: m.Settings })));
const HistorySettings = lazy(() => import("./HistorySettings").then(m => ({ default: m.HistorySettings })));

/** The views, grouped by what you are doing: laying out the plan, watching it run,
 * reshaping it, and sending it to GitHub. */
const GROUPS: { label: string; views: { id: ViewId; label: string }[] }[] = [
  { label: "Plan", views: [
    { id: "overview", label: "Overview" },
    { id: "gantt", label: "Gantt" },
    { id: "plan", label: "Plan" },
    { id: "roadmap", label: "Roadmap" },
    { id: "releases", label: "Releases" },
    { id: "schedule", label: "Schedule" },
  ] },
  { label: "Track", views: [
    { id: "progress", label: "Progress" },
    { id: "workload", label: "Status & workload" },
    { id: "burnup", label: "Burn-up" },
    { id: "confidence", label: "Release confidence" },
    { id: "dependencies", label: "Dependencies" },
  ] },
  { label: "Shape", views: [
    { id: "epics", label: "Epic Map" },
    { id: "planner", label: "Planner" },
    { id: "compare", label: "Compare" },
  ] },
  { label: "Ship", views: [
    { id: "review", label: "Review changes" },
    { id: "changes", label: "What changed" },
  ] },
  { label: "Set up", views: [
    { id: "ai", label: "AI" },
    { id: "settings", label: "Settings" },
  ] },
];
/** Every view in order, for the command menu. Review is reached from the change count. */
const TABS = GROUPS.flatMap(g => g.views).filter(v => v.id !== "review");

export function ProjectScreen({ source, view, onSignOut, onTokenRejected, onChangeToken }: {
  source: Source; view: ViewId; onSignOut?: () => void;
  /** GitHub turned the token down: ask for a new one, and come back to this view. */
  onTokenRejected?: () => void;
  /** Replace the token by choice, before or after it expires. */
  onChangeToken?: () => void;
}) {
  const state = useProject(source);
  const { project, mapping, loading, progress, error, errorKind } = state;
  const rate = source.kind === "github" ? source.client.state.rateLimit : null;
  // A rejected token with nothing loaded leaves nothing to look at: go and make a new one.
  // With a copy loaded, the copy stays on screen and the callout offers the same.
  useEffect(() => {
    if (errorKind === "auth" && !project && onTokenRejected) onTokenRejected();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorKind, project]);
  const owner = source.kind === "github" ? source.owner : DEMO_OWNER;
  const number = source.kind === "github" ? source.number : 1;
  const cs = useChangeSet(owner, number, project, mapping);
  const [githubOnly, setGithubOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);
  // What you said goes into the command box, so speaking and typing are one thing.
  const [command, setCommand] = useState("");
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

  // Push to talk: hold the key, speak, let go. It works while you are typing, because it
  // is checked before the "you are typing in a field" rule.
  const dictation = useDictation(prefs.local, text => { setCommand(text); setMenuOpen(true); });
  // Keyboard: Ctrl/Cmd+K command menu, Ctrl+Shift+Space push to talk, Ctrl+Z / Ctrl+Shift+Z
  // (or Ctrl+Y) undo and redo, [ and ] shift the selection a week, Esc clears it. Ignored
  // while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "k") { e.preventDefault(); setMenuOpen(o => !o); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "Space") { e.preventDefault(); dictation.toggle(); return; }
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
        // The same move a drag makes, dependents included: the shift mode says what
        // happens to the work that waits for this.
        const ops = [...selected].flatMap(k => {
          if (!cs.applied || !mapping) return [];
          const from = schedule?.bars.get(k);
          if (!from) return shiftDates(cs.applied.project, mapping, [k], days);
          return setDatesWithDependents(cs.applied.project, mapping, k, addDays(from.start, days), addDays(from.end, days), prefs.shiftMode);
        });
        editor.record(`Shifted ${selected.size} item${selected.size > 1 ? "s" : ""} ${days > 0 ? "a week later" : "a week earlier"}`, ops);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [cs, githubOnly, menuOpen, selected, editor, mapping, dictation]);
  // Push to talk: hold the key, speak, let go. It works while you are typing, because it
  // is checked before the "you are typing in a field" rule.
  // The dates as they stand, draft included: the keyboard shift moves from these.
  const schedule = useMemo(() => (shown && mapping ? buildSchedule(shown, mapping, draft) : null), [shown, mapping, draft]);
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
      <GlobalMic settings={prefs.local} />
      <AiStatus settings={prefs.local} settingsHref={hrefFor(routeFor("ai"))} />
      {source.kind === "github" && (
        <>
          {rate && rate.remaining < 500 && (
            <span className="pill warn" title={`Resets at ${new Date(rate.resetAt).toLocaleTimeString()}`}>{rate.remaining} API points left this hour</span>
          )}
          <button className="btn" onClick={state.refresh} disabled={loading}
            title={project ? `Loaded at ${new Date(project.loadedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : undefined}>
            {loading ? (progress ? `Loading ${progress.loaded}/${progress.total}…` : "Loading…") : "Refresh"}
          </button>
        </>
      )}
    </div>
  );
  const pending = githubOnly ? 0 : cs.net.length;
  const nav = (
    <aside className="sidenav">
      {GROUPS.map(g => (
        <nav key={g.label} className="nav-group" aria-label={g.label}>
          <h2>{g.label}</h2>
          {g.views.map(t => (
            <a key={t.id} className="nav-link" href={hrefFor(routeFor(t.id))} aria-current={t.id === active ? "page" : undefined}>
              {t.label}
              {t.id === "review" && pending > 0 && <span className="pill count num">{pending}</span>}
            </a>
          ))}
        </nav>
      ))}
      {/* Things about the app rather than the plan: kept out of the top bar. */}
      <div className="nav-foot">
        <ThemeToggle />
        <a className="nav-link" href="#/">All projects</a>
        {onChangeToken && <button className="nav-link" onClick={onChangeToken}>Change GitHub token</button>}
        {onSignOut && <button className="nav-link" onClick={onSignOut}>Sign out</button>}
      </div>
    </aside>
  );

  return (
    <>
      <TopBar crumb={crumb} right={right} />
      <div className="shell">
      {nav}
      <main className="page">
        {error && (
          <div className="callout bad" role="alert" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span>{error} {project && "Showing the last loaded copy."}</span>
            {errorKind === "auth" && onTokenRejected && <button className="btn primary" onClick={onTokenRejected}>Create a new token</button>}
            {errorKind === "not-found" && <a className="btn" href="#/">Choose another project</a>}
          </div>
        )}
        {cs.ready && !cs.persistent && (
          <div className="callout warn">This browser's storage isn't responding, so your changes won't be kept after you close this tab. Review and apply them before leaving.</div>
        )}
        {!project && !error && <p className="muted">{progress ? `Loading items ${progress.loaded} of ${progress.total}…` : "Loading the project…"}</p>}
        {shown && mapping && (
          <Suspense fallback={<p className="muted">Loading the view…</p>}>
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
            {active === "compare" && <Compare project={shown} mapping={mapping} editor={editor} local={prefs.local}
              onGoToReview={() => { location.hash = hrefFor(routeFor("review")); }} />}
            {active === "planner" && <Planner project={shown} mapping={mapping} editor={editor} local={prefs.local} />}
            {active === "changes" && project && (
              <Changes base={project} edited={shown} mapping={mapping} history={history} compareId={compare?.id ?? null}
                onCompare={(id, b) => { compareTo(id, b); if (id) location.hash = hrefFor(routeFor("gantt")); }} settingsHref={hrefFor(routeFor("settings"))} />
            )}
            {active === "review" && project && cs.editor && (
              <Review key={cs.scenarios.active} base={project} groups={cs.groups} titleOf={cs.editor.titleOf} client={source.kind === "github" ? source.client : null}
                onApplied={slots => cs.removeSlots(slots)} onRecord={(label, ops) => cs.editor!.record(label, ops)} refresh={state.refresh}
                mapping={mapping} history={history} scenario={cs.scenarios.list.find(s => s.id === cs.scenarios.active)?.name ?? "Default"}
                goBack={() => { location.hash = hrefFor(routeFor("gantt")); }} />
            )}
            {active === "ai" && <Ai prefs={prefs} setPrefs={setPrefs} />}
            {active === "settings" && project && <Settings project={project} mapping={mapping} setMapping={state.setMapping} resetMapping={state.resetMapping} prefs={prefs} setPrefs={setPrefs} aiHref={hrefFor(routeFor("ai"))}
              extra={<HistorySettings history={history} owner={owner} number={number} canShare={source.kind === "github"}
                repos={[...new Set(project.items.map(i => i.repo).filter((r): r is string => !!r))].sort()} />} />}
          </Suspense>
        )}
        <UndoToast action={cs.lastAction} onUndo={() => { const u = cs.lastAction?.undo; if (u) u(); else cs.undo(); }}
          canUndo={(cs.canUndo || !!cs.lastAction?.undo) && !githubOnly} />
        {menuOpen && shown && mapping && (
          <CommandMenu project={shown} mapping={mapping} editor={editor} selected={selected} onSelect={setSelected}
            views={TABS} go={v => { location.hash = hrefFor(routeFor(v as ViewId)); }}
            undo={cs.undo} redo={cs.redo} toggleGithubOnly={() => setGithubOnly(g => !g)} onClose={() => setMenuOpen(false)}
            local={prefs.local} speak={say} value={command} onQuery={setCommand} schedule={schedule ?? undefined} />
        )}
      </main>
      </div>
    </>
  );
}
