import { useEffect, useMemo, useRef, useState } from "react";
import { defaultLocal, type LocalSettings } from "../ai/local";
import { analyze, scoreIfMoved, type EpicMapModel } from "../model/epicmap";
import { categoryName } from "../model/epicmap/categories";
import { LENSES, lensColours, lensValue, type Lens } from "../model/epicmap/lens";
import { quests } from "../model/epicmap/quests";
import { ideaSuggestion, suggestions, visibleSuggestions, type Suggestion, type SuggestionMemory } from "../model/epicmap/suggest";
import { moveToParent } from "../model/edits";
import type { Mapping } from "../model/mapping";
import type { Project } from "../model/normalize";
import type { Op } from "../model/ops";
import { buildPlan } from "../model/plan/cpm";
import { buildSchedule, findConflicts, type Draft } from "../model/schedule";
import { rejectSuggestion, snoozeSuggestion, readSuggestionMemory } from "../store/epicmap";
import { ItemDrawer } from "./ItemDrawer";
import type { Editor } from "./useChangeSet";
import type { HistoryState } from "./useHistory";
import type { DropTarget, MapCanvas } from "./epicmap/canvas";
import { MeetingMode, type AgendaItem, type MeetingTally } from "./epicmap/MeetingMode";
import { Suggestions } from "./epicmap/Suggestions";
import { Timelapse } from "./epicmap/Timelapse";
import { PlanProblems } from "./plan/PlanProblems";
import { useLocalChat, useLocalVectors } from "./useLocalModel";
import "./epicmap/epicmap.css";

export function EpicMap({ project, mapping, draft, editor, local, history, reviewHref }: {
  project: Project; mapping: Mapping; draft: Draft; editor?: Editor;
  local?: LocalSettings;
  /** The plan history, for the timelapse and the quests. */
  history?: HistoryState;
  /** Where the Review tab is, for the end of a meeting. */
  reviewHref?: string;
}) {
  const [openOnly, setOpenOnly] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [hover, setHover] = useState<{ key: string; target: DropTarget } | null>(null);
  const [memory, setMemory] = useState<SuggestionMemory>({});
  const [lit, setLit] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("category");
  const [meeting, setMeeting] = useState(false);
  const [tally, setTally] = useState<MeetingTally>({ moves: 0, merges: 0, epics: 0, score: 0 });
  const settings = local ?? defaultLocal;
  // With a model on this computer, the map compares work by meaning.
  const vectors = useLocalVectors(project, settings);
  const model = useMemo(() => analyze(project, mapping, { openOnly, vectors: vectors.vectors }), [project, mapping, openOnly, vectors.vectors]);
  const chat = useLocalChat(project, model, settings);
  // The score when the tab opened, so a meeting can see how far it moved things.
  const [startScore] = useState(() => model.score);
  // The map as it was, so the quests can see how far the team has come.
  const [startModel] = useState(() => model);
  const byKey = useMemo(() => new Map(project.items.map(i => [i.key, i])), [project]);
  const title = (k: string | null) => (k ? byKey.get(k)?.title ?? k : "No epic");

  const record = (label: string, ops: Op[]) => { if (editor && ops.length) editor.record(label, ops); };
  const move = (taskKey: string, to: string | null) => {
    const item = byKey.get(taskKey);
    if (item) record(to ? `Moved ${item.title} under ${title(to)}` : `Took ${item.title} out of ${title(item.parentKey)}`, moveToParent(project, item, to));
  };

  // The deck of advice: everything the map thinks is worth doing.
  const all = useMemo(() => {
    const mine = suggestions(model, project, mapping);
    // Ideas from the local model become suggestions too, with a name of their own.
    const ideas = chat.ideas.map(i => ideaSuggestion(model, project, mapping, i)).filter((s): s is Suggestion => !!s);
    return [...mine, ...ideas];
  }, [model, project, mapping, chat.ideas]);
  const deck = useMemo(() => visibleSuggestions(all, memory), [all, memory]);
  useEffect(() => { void readSuggestionMemory(project.owner, project.number).then(setMemory); }, [project.owner, project.number]);
  const accept = (s: Suggestion) => {
    record(`Accepted: ${s.title}`, s.ops);
    // What the team did in this meeting, for the tally at the end.
    setTally(t => ({
      ...t,
      moves: t.moves + (s.kind === "move" ? 1 : 0),
      merges: t.merges + (s.kind === "merge" ? 1 : 0),
      epics: t.epics + (s.kind === "gap" ? 1 : 0),
    }));
  };
  const turnDown = (s: Suggestion) => {
    setMemory(m => ({ ...m, [s.id]: "rejected" }));
    void rejectSuggestion(project.owner, project.number, s.id);
  };
  const wait = (s: Suggestion) => {
    const snoozedUntil = new Date(Date.now() + 7 * 86400000).toISOString();
    setMemory(m => ({ ...m, [s.id]: { snoozedUntil } }));
    void snoozeSuggestion(project.owner, project.number, s.id);
  };

  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<MapCanvas | null>(null);
  const latest = useRef({ move, model, lens });
  latest.current = { move, model, lens };
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let dead = false;
    import("./epicmap/canvas").then(({ mountCanvas }) => {
      if (dead || !box.current) return;
      canvas.current = mountCanvas(box.current, {
        open: setOpen,
        hover: (key, target) => setHover(target === undefined ? null : { key, target }),
        drop: (key, target) => latest.current.move(key, target),
        // Clicking a gap bubble points at the suggestion that would fill it.
        gap: category => {
          const id = `gap:${category}`;
          setLit(id);
          document.getElementById(`emap-suggestion-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        },
      });
      canvas.current.update(latest.current.model, !editor, latest.current.lens);
    }, () => setFailed(true));
    return () => { dead = true; canvas.current?.destroy(); canvas.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { canvas.current?.update(model, !editor, lens); }, [model, editor, lens]);

  const schedule = useMemo(() => buildSchedule(project, mapping, draft), [project, mapping, draft]);
  const original = useMemo(() => buildSchedule(editor?.base ?? project, mapping), [editor?.base, project, mapping]);
  // Whether the plan can work as written: the epic structure is one half, the dates and
  // the links between the epics are the other.
  const plan = useMemo(() => buildPlan(project, mapping, schedule), [project, mapping, schedule]);
  const openItem = open ? schedule.byKey.get(open) : null;
  const preview = hover ? scoreIfMoved(model, hover.key, hover.target ?? null) : null;
  const delta = preview !== null && model.score !== null ? preview - model.score : null;
  const sessionDelta = model.score !== null && startScore !== null ? model.score - startScore : 0;
  const epics = [...model.epics].sort((a, b) => (a.health ?? 101) - (b.health ?? 101));
  const connected = vectors.status === "on" || chat.status === "on";
  const unreachable = settings.enabled && !connected && vectors.status !== "working" && chat.status !== "working";

  // What the map is coloured by, and the groups that come out of it.
  const groups = useMemo(() => {
    if (lens === "category") return null;
    const values = [...model.epics.map(e => lensValue(lens, e)), ...model.tasks.map(t => lensValue(lens, t))];
    const colours = lensColours(values);
    return [...colours.keys()].map(value => ({ value, colour: colours.get(value)! }));
  }, [lens, model]);

  // The quests the team is working through, and the ones already finished.
  const questList = useMemo(() => quests(startModel, model), [startModel, model]);
  const savedQuests = useRef(new Set<string>());
  useEffect(() => {
    const done = questList.filter(q => q.done && !savedQuests.current.has(q.id));
    if (!done.length || !history) return;
    for (const q of done) savedQuests.current.add(q.id);
    void history.saveQuest({ version: 1, at: new Date().toISOString(), author: history.author, quests: done.map(q => ({ id: q.id, name: q.name })) });
  }, [questList, history]);

  // The agenda of a meeting: the worst epics first, then the best advice.
  const agenda = useMemo<AgendaItem[]>(() => [
    ...epics.slice(0, 5).map(e => ({
      id: `epic:${e.key}`, kind: "epic" as const, title: e.title,
      why: e.flags.length ? e.flags.join(" · ") : `Health ${e.health ?? "—"}, ${e.taskKeys.length} tasks.`,
      focus: [e.key],
    })),
    ...deck.slice(0, 5).map(s => ({ id: s.id, kind: "suggestion" as const, title: s.title, why: s.why, focus: s.epics, suggestion: s })),
  ], [epics, deck]);

  return (
    <div className="emap">
      <div className="section-h">
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800 }}>Epic Map</h1>
          <p className="muted" style={{ maxWidth: "80ch" }}>Each bubble is an epic and each dot a task, coloured by the kind of work it is. Related work drifts together, red bands show epics that overlap, dashed bubbles are kinds of work no epic owns. Drag a dot into another epic to move it; the score shows whether that makes the epics more independent.</p>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <span className={`pill ${connected ? "accent" : unreachable ? "warn" : ""}`} title={unreachable ? "The model on this computer did not answer. pm-hub is using its own analysis." : undefined}>
            {connected ? "✦ Model ready" : unreachable ? "✦ Model not answering" : "Local analysis"}
          </span>
          <div className="seg" role="group" aria-label="Colour the map by">
            {LENSES.map(l => <button key={l.id} className={lens === l.id ? "on" : ""} onClick={() => setLens(l.id)}>{l.name}</button>)}
          </div>
          <label className="check-row"><input id="em-open" type="checkbox" checked={openOnly} onChange={() => setOpenOnly(!openOnly)} /> Open work only</label>
          <button className="btn" onClick={() => setMeeting(true)}>Meeting mode</button>
          <button className="btn" onClick={() => canvas.current?.fit()}>Fit</button>
          <button className="btn" onClick={() => canvas.current?.relayout()}>Shuffle layout</button>
        </div>
      </div>

      <div className="emap-body">
        <div className="card emap-canvas-wrap">
          <div ref={box} className="emap-canvas" role="img"
            aria-label="Map of epics and their tasks. Everything it shows is also in the panel beside it, which reads as text." />
          {failed && <p className="callout bad emap-float">The map couldn't load. Reload the page to try again.</p>}
          {!editor && <span className="pill emap-float">Read-only: turn off “GitHub only” to move tasks</span>}
          {hover && (
            <div className={`emap-preview ${delta === null ? "" : delta > 0 ? "up" : delta < 0 ? "down" : ""}`} aria-live="polite">
              Drop into <b>{title(hover.target ?? null)}</b>{delta !== null && <>: score {delta > 0 ? "+" : ""}{delta}</>}
            </div>
          )}
        </div>

        <aside className="emap-panel">
          <section className="card pad emap-score">
            <div className="muted">Structure score</div>
            <div className="emap-score-v">{model.score ?? "—"}<span>/100</span></div>
            <div className="emap-meter"><i style={{ width: `${model.score ?? 0}%` }} /></div>
            <p className="muted">How much related work sits inside the same epic. {sessionDelta !== 0 && <b className={sessionDelta > 0 ? "good" : "bad"}>{sessionDelta > 0 ? "+" : ""}{sessionDelta} since you opened the map</b>}</p>
          </section>

          <Suggestions
            items={deck}
            onAccept={accept}
            onReject={turnDown}
            onSnooze={wait}
            onFocus={s => canvas.current?.focusMany(s ? (s.epics.length ? s.epics : s.items.slice(0, 3)) : [])}
            readOnly={!editor}
            highlight={lit}
          />

          <PlanProblems plan={plan} onFocus={keys => canvas.current?.focusMany(keys)} />

          {model.overlaps.length > 0 && (
            <section className="card pad">
              <h3>Overlapping epics</h3>
              <ul className="emap-list">
                {model.overlaps.slice(0, 5).map(o => (
                  <li key={o.a + o.b}>
                    <b>{Math.round(o.score * 100)}%</b> {title(o.a)} ↔ {title(o.b)}
                    {o.shared.length > 0 && <div className="muted">shared: {o.shared.join(", ")}</div>}
                    {chat.whys.get(`${o.a}|${o.b}`) && <div className="muted">✦ {chat.whys.get(`${o.a}|${o.b}`)}</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card pad">
            <h3>Epic health</h3>
            <ul className="emap-list">
              {epics.map(e => (
                <li key={e.key}>
                  <button className="emap-link" onClick={() => canvas.current?.focus(e.key)}>{e.title}</button>
                  <span className={`pill ${e.health === null ? "" : e.health >= 70 ? "good" : e.health >= 55 ? "warn" : "bad"}`}>{e.health ?? "—"}</span>
                  <div className="muted"><span className="emap-swatch" style={{ background: `var(--cat-${e.category})` }} /> {categoryName(e.category)} · {e.taskKeys.length} tasks{e.priority ? ` · ${e.priority}` : ""}{e.release ? ` · ${e.release}` : ""}</div>
                  {chat.mixes.get(e.key) && <div className="muted">✦ {chat.mixes.get(e.key)}</div>}
                  {e.flags.length > 0 && <div className="muted emap-flags">{e.flags.join(" · ")}</div>}
                </li>
              ))}
            </ul>
          </section>

          {groups ? (
            <section className="card pad">
              <h3>{LENSES.find(l => l.id === lens)?.name}</h3>
              <ul className="emap-legend">
                {groups.map(g => <li key={g.value}><span className="emap-swatch" style={{ background: `var(--cat-${g.colour})` }} /> {g.value}</li>)}
              </ul>
            </section>
          ) : (
            <section className="card pad">
              <h3>Kinds of work</h3>
              <ul className="emap-legend">
                {model.categories.map(c => (
                  <li key={c.id}><span className="emap-swatch" style={{ background: `var(--cat-${c.id})` }} /> {categoryName(c.id)} <span className="muted">{c.tasks} tasks · {c.epics} epics</span></li>
                ))}
              </ul>
            </section>
          )}

          <section className="card pad">
            <h3>Quests</h3>
            <ul className="emap-list">
              {questList.map(q => (
                <li key={q.id}>
                  <span className={`pill ${q.done ? "good" : ""}`}>{q.done ? "Done" : `${q.progress}/${q.goal}`}</span>
                  <span>{q.name}</span>
                </li>
              ))}
            </ul>
            {history && history.quests.length > 0 && (
              <p className="muted">Finished before: {history.quests.flatMap(r => r.quests.map(q => q.name)).join(", ")}</p>
            )}
          </section>

          {history && (
            <Timelapse project={project} mapping={mapping} history={history} current={model}
              show={m => canvas.current?.update(m, true, lens)} />
          )}
        </aside>
      </div>

      {openItem && <ItemDrawer item={openItem} project={project} mapping={mapping} schedule={schedule} original={original} draft={draft}
        conflicts={findConflicts(schedule, draft)} editor={editor} onClose={() => setOpen(null)} onOpen={setOpen} />}

      {meeting && (
        <MeetingMode
          agenda={agenda}
          tally={{ ...tally, score: sessionDelta }}
          onClose={() => setMeeting(false)}
          onFocus={item => canvas.current?.focusMany(item.focus.length ? item.focus : item.suggestion?.items.slice(0, 3) ?? [])}
          onAccept={accept}
          reviewHref={reviewHref ?? "#"}
          readOnly={!editor}
        />
      )}
    </div>
  );
}

export type { EpicMapModel };
