// Releases as a plan of epics. The train along the top shows every release on one line
// of time, how far along each is and whether it can make its date; the board below holds
// the epics, and an epic is moved between releases by dragging it (its open work goes
// with it). New releases are made here, and a release's date is changed in its column.
import { useMemo, useState, type DragEvent } from "react";
import type { LocalSettings } from "../ai/local";
import type { Mapping } from "../model/mapping";
import type { Project } from "../model/normalize";
import type { Op } from "../model/ops";
import { buildPlan } from "../model/plan/cpm";
import {
  createRelease, moveEpicToRelease, releaseAbilities, releaseBoard, releaseRepos, setReleaseDue, workOf,
  type ReleaseColumn, type ReleaseEpic, type ReleaseInfo, type ReleaseStatus,
} from "../model/releases";
import { releaseOf } from "../model/mapping";
import { buildSchedule, findConflicts, type Draft } from "../model/schedule";
import { ItemDrawer } from "./ItemDrawer";
import type { Editor } from "./useChangeSet";
import { usePlacementAI } from "./useEpicAI";
import "./releases.css";

const fmt = (d: string | null) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "No date");
const fmtShort = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const todayIso = () => new Date().toISOString().slice(0, 10);

const STATUS: Record<ReleaseStatus, { label: string; tone: string }> = {
  "done": { label: "Shipped", tone: "good" },
  "overdue": { label: "Overdue", tone: "bad" },
  "at-risk": { label: "At risk", tone: "warn" },
  "on-track": { label: "On track", tone: "good" },
  "no-date": { label: "No date", tone: "" },
  "empty": { label: "Empty", tone: "" },
};

export function Releases({ project, mapping, draft, editor, local, aiHref }: {
  project: Project; mapping: Mapping; draft: Draft; editor?: Editor;
  local?: LocalSettings;
  aiHref?: string;
}) {
  const today = todayIso();
  const settings = local ?? { enabled: false, base: "", chatModel: "", embedModel: "" };
  const schedule = useMemo(() => buildSchedule(project, mapping, draft), [project, mapping, draft]);
  const original = useMemo(() => buildSchedule(project, mapping), [project, mapping]);
  const conflicts = useMemo(() => findConflicts(schedule, draft), [schedule, draft]);
  const plan = useMemo(() => buildPlan(project, mapping, schedule), [project, mapping, schedule]);
  const board = useMemo(() => releaseBoard(project, mapping, schedule, plan, today), [project, mapping, schedule, plan, today]);
  const abilities = releaseAbilities(mapping);
  const ai = usePlacementAI(project, mapping, plan, board, settings, today);

  const [showDone, setShowDone] = useState(false);
  const [showStories, setShowStories] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [allProblems, setAllProblems] = useState(false);
  const openItem = open ? schedule.byKey.get(open) : null;
  const byKey = useMemo(() => new Map(project.items.map(i => [i.key, i])), [project]);

  if (mapping.release.kind === "none") {
    return <div className="card pad"><p>This project has no releases set up. Add milestones or an iteration field on GitHub, or pick one in <a href={location.hash.replace(/\/[a-z]+$/, "/settings")}>Settings</a>.</p></div>;
  }

  const record = (label: string, ops: Op[]) => { if (editor && ops.length) editor.record(label, ops); };
  const colId = (c: ReleaseColumn) => c.release?.id ?? "none";
  const visible = board.columns.filter(c => !c.release || showDone || (!c.release.closed && c.status !== "done"));
  const hidden = board.columns.length - visible.length;
  const releases = board.columns.filter(c => c.release).map(c => c.release!);

  const moveEpic = (key: string, to: ReleaseInfo | null) => {
    const epic = byKey.get(key);
    if (!epic) return;
    const ops = moveEpicToRelease(project, mapping, epic, to);
    const stories = ops.filter(o => "key" in o && o.key !== key).length;
    record(`Moved “${epic.title}” to ${to?.title ?? "no release"}${stories ? ` with ${stories} ${stories === 1 ? "story" : "stories"}` : ""}`, ops);
  };
  const onDrop = (c: ReleaseColumn) => (e: DragEvent) => {
    e.preventDefault();
    const key = e.dataTransfer.getData("text/plain") || dragging;
    setDragging(null); setOver(null);
    if (key) moveEpic(key, c.release);
  };

  // What breaks a release first, then what makes it tight, then what is worth tidying.
  const RANK = { order: 0, late: 1, split: 2, unplanned: 3 } as const;
  const problems = board.problems.filter(p => !dismissed.has(`${p.kind}:${p.keys.join(",")}`)).sort((a, b) => RANK[a.kind] - RANK[b.kind]);
  const placements = ai.items.filter(p => !dismissed.has(p.id));

  return (
    <div className="rel-view">
      <div className="section-h">
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 20 }}>Releases</h1>
          <p className="muted" style={{ maxWidth: "80ch" }}>
            Each release holds epics; an epic’s open stories go where it goes. {editor ? "Drag an epic to another release to move it." : "Showing GitHub only: releases can’t be changed."}
          </p>
        </div>
        <div className="drow" style={{ alignItems: "center" }}>
          <label className="check"><input type="checkbox" checked={showStories} onChange={e => setShowStories(e.target.checked)} /> Show stories</label>
          <label className="check"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> Show shipped{hidden && !showDone ? ` (${hidden})` : ""}</label>
          {editor && abilities.create && <button className="btn primary" onClick={() => setCreating(c => !c)} aria-expanded={creating}>New release</button>}
        </div>
      </div>

      {editor && !abilities.create && abilities.why && <p className="muted" style={{ fontSize: 12 }}>{abilities.why}</p>}
      {creating && editor && (
        <NewRelease project={project} existing={releases} onCancel={() => setCreating(false)}
          onCreate={(title, due, repos) => { record(`New release “${title}”`, createRelease(project, mapping, title, due, repos)); setCreating(false); }} />
      )}

      <Train releases={releases.filter(r => !r.closed || showDone)} columns={board.columns} today={today} />

      <div className="rel-board">
        {visible.map(c => (
          <section key={colId(c)} className={`card rel-col ${over === colId(c) ? "over" : ""} ${c.release ? "" : "none"}`}
            onDragOver={e => { if (!editor || !dragging) return; e.preventDefault(); setOver(colId(c)); }}
            onDragLeave={() => setOver(o => (o === colId(c) ? null : o))}
            onDrop={editor ? onDrop(c) : undefined}>
            <ColumnHead c={c} editable={!!editor && abilities.date && !!c.release && !c.release.closed}
              onDue={due => c.release && record(`${c.release.title} due ${fmt(due)}`, setReleaseDue(project, mapping, c.release, due))} />
            <div className="rel-cards">
              {c.epics.length === 0 && <p className="muted rel-empty">{c.release ? (editor ? "Drag epics here." : "No epics yet.") : "Every epic is in a release."}</p>}
              {c.epics.map(e => (
                <EpicCard key={e.key} e={e} column={c} releases={releases.filter(r => !r.closed)} editor={!!editor}
                  stories={showStories ? workOf(project, mapping, byKey.get(e.key)!).filter(s => s.state === "open").map(s => ({ key: s.key, title: s.title, release: releaseOf(s, mapping)?.title ?? null })) : null}
                  onOpen={() => setOpen(e.key)} onOpenStory={setOpen}
                  onMove={to => moveEpic(e.key, to)}
                  onDragStart={() => setDragging(e.key)} onDragEnd={() => { setDragging(null); setOver(null); }} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="grid2">
        <section className="card pad rel-attn">
          <h2>Needs attention</h2>
          {problems.length === 0 && <p className="muted">Nothing: every epic is in a release it can make, after everything it waits for.</p>}
          <ul>
            {problems.slice(0, allProblems ? undefined : 4).map(p => {
              const id = `${p.kind}:${p.keys.join(",")}`;
              return (
                <li key={id} className={`rel-problem ${p.kind}`}>
                  <span>{p.message}</span>
                  {editor && (
                    <span className="drow">
                      {p.fix && <button className="btn small" onClick={() => record(p.fix!.label, p.fix!.ops)}>{p.fix.label}</button>}
                      <button className="linkbtn" onClick={() => setDismissed(d => new Set([...d, id]))}>dismiss</button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {problems.length > 4 && (
            <button className="linkbtn" style={{ justifySelf: "start" }} onClick={() => setAllProblems(a => !a)}>
              {allProblems ? "Show fewer" : `Show all ${problems.length}`}
            </button>
          )}
        </section>

        <section className="card pad rel-attn">
          <h2>Where should epics go?</h2>
          {ai.status === "nothing" ? (
            <p className="muted">
              Nothing to ask: every epic that needs a release has at most one it can go in without breaking the plan, and
              that is offered under <b>Needs attention</b>.
            </p>
          ) : ai.status === "off" ? (
            <p className="muted">
              An AI model can propose a release for each epic that has none, or one it cannot make. Every proposal is checked
              against the dependencies and the dates before it is shown. {aiHref ? <a href={aiHref}>Set up the AI</a> : null}
            </p>
          ) : (
            <>
              <span>
                <button className="btn" onClick={ai.ask} disabled={ai.status === "working"}>
                  {ai.status === "working" ? "Planning the releases…" : ai.status === "done" ? "Ask again" : "Ask the AI to place the epics"}
                </button>
              </span>
              {ai.error && <p className="bad" style={{ fontSize: 12 }}>{ai.error}</p>}
              {ai.status === "done" && placements.length === 0 && <p className="muted">Nothing to change{ai.cached ? " (answered before)" : ""}.</p>}
              <ul>
                {placements.map(p => (
                  <li key={p.id} className="rel-problem">
                    <span><b>{p.title}</b> → {p.release}{p.why ? <span className="muted">. {p.why}</span> : null}</span>
                    {editor && (
                      <span className="drow">
                        <button className="btn small" onClick={() => record(`Moved “${p.title}” to ${p.release}`, p.ops)}>Move it</button>
                        <button className="linkbtn" onClick={() => setDismissed(d => new Set([...d, p.id]))}>dismiss</button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {ai.status === "done" && ai.dropped > 0 && <p className="muted" style={{ fontSize: 12 }}>{ai.dropped} proposal{ai.dropped === 1 ? "" : "s"} left out: {ai.reasons.join("; ")}.</p>}
            </>
          )}
        </section>
      </div>

      {openItem && <ItemDrawer item={openItem} mapping={mapping} schedule={schedule} original={original} conflicts={conflicts} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Every release on one line of time: when it is due, how much is done, and whether it will make it. */
function Train({ releases, columns, today }: { releases: ReleaseInfo[]; columns: ReleaseColumn[]; today: string }) {
  const dated = releases.filter(r => r.due);
  if (!dated.length) return null;
  const col = new Map(columns.filter(c => c.release).map(c => [c.release!.id, c]));
  const dates = [...dated.map(r => r.due!), today, ...columns.map(c => c.finish).filter((d): d is string => !!d)].sort();
  const lo = addDays(dates[0]!, -10), hi = addDays(dates[dates.length - 1]!, 10);
  const span = Math.max(1, days(lo, hi));
  const x = (d: string) => `${(100 * days(lo, d)) / span}%`;
  return (
    <section className="card rel-train" aria-label="Releases over time">
      <div className="rel-track">
        <span className="rel-today" style={{ left: x(today) }}><span>Today</span></span>
        {dated.map((r, i) => {
          const c = col.get(r.id);
          const from = i === 0 ? lo : dated[i - 1]!.due!;
          const pct = c && c.total ? Math.round((100 * c.done) / c.total) : 0;
          const st = STATUS[c?.status ?? "empty"];
          return (
            <div key={r.id}>
              <span className={`rel-span ${st.tone}`} style={{ left: x(from), width: `calc(${x(r.due!)} - ${x(from)})` }}>
                <span style={{ width: `${pct}%` }} />
              </span>
              {c?.finish && c.finish > r.due! && (
                <span className="rel-slip" style={{ left: x(r.due!), width: `calc(${x(c.finish)} - ${x(r.due!)})` }} title={`Its last epic finishes ${fmtShort(c.finish)}`} />
              )}
              <span className={`rel-stop ${st.tone}`} style={{ left: x(r.due!) }} title={`${r.title}: ${st.label}, ${pct}% done`}>
                <b>{r.title}</b>
                <span className="num">{fmtShort(r.due!)} · {pct}%</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ColumnHead({ c, editable, onDue }: { c: ReleaseColumn; editable: boolean; onDue: (due: string | null) => void }) {
  const pct = c.total ? Math.round((100 * c.done) / c.total) : 0;
  const st = STATUS[c.status];
  if (!c.release) {
    return (
      <div className="rel-head">
        <div className="rel-title"><h3>Not in a release</h3><span className="pill">{c.epics.length}</span></div>
        <span className="muted" style={{ fontSize: 12 }}>Open epics with no release yet.</span>
      </div>
    );
  }
  return (
    <div className="rel-head">
      <div className="rel-title">
        <h3>{c.release.title}</h3>
        <span className={`pill ${st.tone}`}>{st.label}</span>
      </div>
      <div className="rel-due">
        {editable ? (
          <label className="muted">Due{" "}
            <DueInput value={c.release.due} label={`${c.release.title} due date`} onCommit={onDue} />
          </label>
        ) : <span className="muted">{c.release.due ? `Due ${fmt(c.release.due)}` : "No due date"}</span>}
        {c.finish && <span className={c.release.due && c.finish > c.release.due ? "bad" : "muted"} title="When its last open epic is planned to finish">Ends {fmtShort(c.finish)}</span>}
      </div>
      <div className="rel-progress">
        <div className="progress" role="img" aria-label={`${pct}% of stories done`}><span style={{ width: `${pct}%` }} /></div>
        <span className="num muted">{c.done}/{c.total}</span>
      </div>
    </div>
  );
}

/**
 * A release date that is recorded when you have finished with it — on leaving the field or
 * pressing Enter — not on every keystroke, which would record "0002-01-15" on the way to 2027.
 */
function DueInput({ value, label, onCommit }: { value: string | null; label: string; onCommit: (due: string | null) => void }) {
  const [text, setText] = useState(value ?? "");
  const [was, setWas] = useState(value);
  if (value !== was) { setWas(value); setText(value ?? ""); }
  const commit = () => { const next = text || null; if (next !== value && (!next || /^\d{4}-\d{2}-\d{2}$/.test(next) && next >= "2000-01-01")) onCommit(next); else setText(value ?? ""); };
  return (
    <input type="date" className="cell-date" value={text} aria-label={label}
      onChange={e => setText(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") setText(value ?? ""); }} />
  );
}

function EpicCard({ e, column, releases, editor, stories, onOpen, onOpenStory, onMove, onDragStart, onDragEnd }: {
  e: ReleaseEpic; column: ReleaseColumn; releases: ReleaseInfo[]; editor: boolean;
  stories: { key: string; title: string; release: string | null }[] | null;
  onOpen: () => void; onOpenStory: (key: string) => void;
  onMove: (to: ReleaseInfo | null) => void;
  onDragStart: () => void; onDragEnd: () => void;
}) {
  const pct = e.total ? Math.round((100 * e.done) / e.total) : e.open ? 0 : 100;
  return (
    <article className={`rel-epic ${e.open ? "" : "closed"} ${e.late || e.waitsFor.length ? "risk" : ""}`}
      draggable={editor && e.open} onDragStart={ev => { ev.dataTransfer.setData("text/plain", e.key); ev.dataTransfer.effectAllowed = "move"; onDragStart(); }} onDragEnd={onDragEnd}>
      <button className="rel-epic-title" onClick={onOpen} title={e.title}>{e.title}</button>
      <div className="rel-epic-meta">
        <div className="progress" role="img" aria-label={`${pct}% done`}><span style={{ width: `${pct}%` }} /></div>
        <span className="num muted">{e.done}/{e.total}</span>
        {e.end && <span className={e.late ? "bad" : "muted"}>{e.open ? `ends ${fmtShort(e.end)}` : "done"}</span>}
      </div>
      {e.late && <span className="rel-flag warn">Finishes after the release is due</span>}
      {e.waitsFor.map(w => <span key={w.key} className="rel-flag bad">Waits for {w.title}{w.release ? ` (${w.release})` : " (no release)"}</span>)}
      {e.elsewhere > 0 && <span className="rel-flag">{e.elsewhere} open {e.elsewhere === 1 ? "story is" : "stories are"} in another release</span>}
      {!e.own && column.release && <span className="rel-flag muted">Here because most of its stories are</span>}
      {stories && stories.length > 0 && (
        <ul className="rel-stories">
          {stories.map(s => (
            <li key={s.key}>
              <button className="linkbtn" onClick={() => onOpenStory(s.key)}>{s.title}</button>
              {s.release !== (column.release?.title ?? null) && <span className="pill">{s.release ?? "no release"}</span>}
            </li>
          ))}
        </ul>
      )}
      {editor && e.open && (
        <label className="rel-move">
          <span className="sr">Move {e.title} to</span>
          <select className="mini-select" value="" onChange={ev => {
            const v = ev.target.value;
            if (!v) return;
            onMove(v === "__none" ? null : releases.find(r => r.id === v) ?? null);
          }}>
            <option value="">Move to…</option>
            {releases.filter(r => r.id !== column.release?.id).map(r => <option key={r.id} value={r.id}>{r.title}{r.due ? ` · ${fmtShort(r.due)}` : ""}</option>)}
            {column.release && <option value="__none">No release</option>}
          </select>
        </label>
      )}
    </article>
  );
}

function NewRelease({ project, existing, onCreate, onCancel }: {
  project: Project; existing: ReleaseInfo[];
  onCreate: (title: string, due: string | null, repos: string[]) => void; onCancel: () => void;
}) {
  const repos = releaseRepos(project);
  const last = [...existing].reverse().find(r => r.due)?.due ?? null;
  const [title, setTitle] = useState(() => suggestName(existing));
  const [due, setDue] = useState(() => (last ? addDays(last, 28) : addDays(todayIso(), 28)));
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(repos));
  const taken = existing.some(r => r.title.toLowerCase() === title.trim().toLowerCase());
  return (
    <form className="card pad rel-new" onSubmit={e => { e.preventDefault(); if (title.trim() && !taken && chosen.size) onCreate(title.trim(), due || null, [...chosen]); }}>
      <h2>New release</h2>
      <div className="rel-new-row">
        <label className="field-edit">Name<input className="input" value={title} onChange={e => setTitle(e.target.value)} autoFocus /></label>
        <label className="field-edit">Due<input className="input" type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
      </div>
      {taken && <span className="bad" style={{ fontSize: 12 }}>There is already a release called that.</span>}
      {repos.length > 1 && (
        <fieldset className="rel-repos">
          <legend className="muted">Make it in</legend>
          {repos.map(r => (
            <label key={r} className="check">
              <input type="checkbox" checked={chosen.has(r)} onChange={e => setChosen(s => { const n = new Set(s); if (e.target.checked) n.add(r); else n.delete(r); return n; })} /> {r}
            </label>
          ))}
          <span className="muted" style={{ fontSize: 12 }}>A release is a milestone in each repository. Moving an epic into it later makes it in any other repository its work is in.</span>
        </fieldset>
      )}
      <p className="muted" style={{ fontSize: 12 }}>It is made on GitHub when you apply your changes, like everything else.</p>
      <div className="drow">
        <button className="btn primary" type="submit" disabled={!title.trim() || taken || !chosen.size}>Add release</button>
        <button className="btn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** "Release 4" after "Release 3": the next name in a numbered series, or nothing to guess from. */
function suggestName(existing: ReleaseInfo[]): string {
  const nums = existing.map(r => r.title.match(/^(.*?)(\d+)$/)).filter((m): m is RegExpMatchArray => !!m);
  if (!nums.length) return "";
  const best = nums.sort((a, b) => Number(b[2]) - Number(a[2]))[0]!;
  return `${best[1]}${Number(best[2]) + 1}`;
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const days = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);

