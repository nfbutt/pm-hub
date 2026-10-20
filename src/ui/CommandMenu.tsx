import { useEffect, useMemo, useState } from "react";
import { buildSchedule, emptyDraft, type Schedule } from "../model/schedule";
import {
  addBlocker, epicOptions, laneOptions, milestoneOptions, moveToParent, newItem, setLane, setMilestone, setOption, setState, shiftDates,
} from "../model/edits";
import type { Mapping } from "../model/mapping";
import type { Item, Project } from "../model/normalize";
import type { Op } from "../model/ops";
import type { Editor } from "../views/useChangeSet";
import { findTargets } from "../model/command/targets";
import { candidateKeys, readPhrase } from "../model/command/phrase";
import { knownValues } from "../model/command/ops";
import { fillSlot, parseIntent, slotPhrase, type Intent, type Slot } from "../model/command/intent";
import { intentOps } from "../model/command/ops";
import { useDictation } from "../views/voice/useDictation";
import { PickList } from "./Picker";

type Step =
  | { kind: "list"; title: string; options: { value: string; label: string; hint?: string }[]; onPick: (v: string) => void }
  | { kind: "text"; title: string; placeholder: string; onSubmit: (text: string) => void }
  /** A phrase that needs to know which item it meant. */
  | { kind: "phrase"; title: string; intent: Intent; slot: Slot; options: { value: string; label: string; hint?: string }[] };

interface Props {
  project: Project; mapping: Mapping; editor?: Editor;
  selected: Set<string>; onSelect: (keys: Set<string>) => void;
  views: { id: string; label: string }[]; go: (view: string) => void;
  undo: () => void; redo: () => void; toggleGithubOnly: () => void;
  onClose: () => void;
  /** The model on this computer, so the microphone has somewhere to send the audio. */
  local?: { enabled: boolean; base: string; chatModel: string; embedModel: string; voiceBase?: string; voiceModel?: string };
  /** Says something out loud, so a spoken command can be answered. */
  speak?: (text: string) => void;
  /** The text in the box, so something else can put words there. */
  value?: string;
  onQuery?: (q: string) => void;
  /** The dates as they stand, for a command that moves something to a day. */
  schedule?: Schedule;
}

/** Ctrl/Cmd+K: every edit and navigation, acting on the current selection. */
export function CommandMenu({ project, mapping, editor, selected, onSelect, views, go, undo, redo, toggleGithubOnly, onClose, local, speak, value, onQuery, schedule }: Props) {
  const [step, setStep] = useState<Step | null>(null);
  const [own, setOwn] = useState("");
  const query = value ?? own;
  const setQuery = (q: string): void => { if (value === undefined) setOwn(q); onQuery?.(q); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); if (step) setStep(null); else onClose(); } };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [step, onClose]);

  const items = [...selected].map(k => project.items.find(i => i.key === k)).filter((i): i is Item => !!i);
  const n = items.length;
  const what = n === 1 ? `“${items[0]!.title}”` : `${n} items`;
  const run = (label: string, ops: Op[]) => { if (editor && ops.length) editor.record(label, ops); onClose(); };
  const statusDef = mapping.statusField ? project.fields.find(f => f.name === mapping.statusField && f.kind === "single") : undefined;
  const prioDef = mapping.priority.kind === "field" ? project.fields.find(f => f.name === (mapping.priority as { field: string }).field && f.kind === "single") : undefined;

  // The microphone: the words go into the same box, so speaking and typing are one thing.
  const dictation = useDictation(local ?? { enabled: false, base: "", chatModel: "", embedModel: "" },
    text => setQuery(query ? `${query} ${text}` : text));

  // What the person typed, read as a sentence: "move the API epic two weeks later".
  const phrase = useMemo(() => (query.trim() && !step ? parseIntent(query) : null), [query, step]);
  // When the grammar has nothing, a model may read it -- but only a target that exists
  // and an action that is one of ours is kept.
  const [guessed, setGuessed] = useState<Intent | null>(null);
  useEffect(() => {
    if (!local?.enabled || !query.trim() || step || phrase) { setGuessed(null); return; }
    const t = setTimeout(() => {
      void readPhrase(local, query.trim(), candidateKeys(project, mapping, query), knownValues(project, mapping).releases)
        .then(i => setGuessed(i));
    }, 700);
    return () => clearTimeout(t);
  }, [query, phrase, step, local, project, mapping]);

  const actions: { id: string; label: string; hint?: string; pinned?: boolean; run: () => void }[] = [];
  if (editor && n > 0) {
    for (const [d, l] of [[7, "+1 week"], [-7, "−1 week"], [14, "+2 weeks"], [-14, "−2 weeks"]] as const)
      actions.push({ id: `shift${d}`, label: `Shift ${what} ${l}`, hint: d === 7 ? "]" : d === -7 ? "[" : undefined, run: () => run(`Shifted ${what} ${l}`, shiftDates(project, mapping, [...selected], d)) });
    if (statusDef?.kind === "single") actions.push({ id: "status", label: `Set ${statusDef.name.toLowerCase()} of ${what}…`, run: () => setStep({ kind: "list", title: statusDef.name, options: statusDef.options.map(o => ({ value: o.name, label: o.name })),
      onPick: v => run(`${statusDef.name} → ${v} for ${what}`, items.flatMap(i => setOption(project, i, statusDef.name, v))) }) });
    if (prioDef?.kind === "single") actions.push({ id: "prio", label: `Set ${prioDef.name.toLowerCase()} of ${what}…`, run: () => setStep({ kind: "list", title: prioDef.name, options: prioDef.options.map(o => ({ value: o.name, label: o.name })),
      onPick: v => run(`${prioDef.name} → ${v} for ${what}`, items.flatMap(i => setOption(project, i, prioDef.name, v))) }) });
    const lanes = laneOptions(project, mapping);
    if (lanes.length) actions.push({ id: "lane", label: `Move ${what} to a lane…`, run: () => setStep({ kind: "list", title: "Lane", options: lanes.map(l => ({ value: l, label: l })),
      onPick: v => run(`Lane → ${v} for ${what}`, items.flatMap(i => setLane(project, mapping, i, v))) }) });
    if (mapping.release.kind === "milestone") actions.push({ id: "release", label: `Set release of ${what}…`, run: () => setStep({ kind: "list", title: "Release",
      options: [{ value: "", label: "No release" }, ...milestoneOptions(project, items[0]!.repo).map(m => ({ value: m.title, label: m.title, hint: m.dueOn?.slice(0, 10) }))],
      onPick: v => run(`Release → ${v || "none"} for ${what}`, items.flatMap(i => setMilestone(i, v ? milestoneOptions(project, i.repo).find(m => m.title === v) ?? null : null))) }) });
    actions.push({ id: "parent", label: `Move ${what} under an epic…`, run: () => setStep({ kind: "list", title: "Epic", options: epicOptions(project, mapping).map(e => ({ value: e.key, label: e.title })),
      onPick: v => run(`Moved ${what} under ${project.items.find(i => i.key === v)?.title}`, items.flatMap(i => moveToParent(project, i, v))) }) });
    if (n === 1) actions.push({ id: "blocker", label: `Mark ${what} as blocked by…`, run: () => setStep({ kind: "list", title: "Blocked by",
      options: project.items.filter(i => i.state === "open" && i.key !== items[0]!.key).map(i => ({ value: i.key, label: i.title, hint: i.number ? `#${i.number}` : undefined })),
      onPick: v => run(`${items[0]!.title} now blocked by ${project.items.find(i => i.key === v)?.title}`, addBlocker(project, items[0]!, v)) }) });
    actions.push({ id: "close", label: `Close ${what} as done`, run: () => run(`Closed ${what}`, items.flatMap(i => setState(i, "closed", "COMPLETED"))) });
    actions.push({ id: "notplanned", label: `Close ${what} as not planned`, run: () => run(`Closed ${what} as not planned`, items.flatMap(i => setState(i, "closed", "NOT_PLANNED"))) });
    actions.push({ id: "reopen", label: `Reopen ${what}`, run: () => run(`Reopened ${what}`, items.flatMap(i => setState(i, "open"))) });
    actions.push({ id: "park", label: `Park ${what}`, run: () => run(`Parked ${what}`, items.map(i => ({ kind: "park", key: i.key, before: false, after: true }) as Op)) });
    actions.push({ id: "clear", label: "Clear the selection", hint: "Esc", run: () => { onSelect(new Set()); onClose(); } });
  }
  if (editor) {
    actions.push({ id: "newepic", label: "New epic…", run: () => setStep({ kind: "text", title: "New epic", placeholder: "Epic title", onSubmit: t => run(`Added epic “${t}”`, newItem(project, mapping, t, { epic: true })) }) });
    actions.push({ id: "newstory", label: "New story under an epic…", run: () => setStep({ kind: "list", title: "Under which epic?", options: epicOptions(project, mapping).map(e => ({ value: e.key, label: e.title })),
      onPick: parent => setStep({ kind: "text", title: `New story under ${project.items.find(i => i.key === parent)?.title}`, placeholder: "Story title", onSubmit: t => run(`Added “${t}”`, newItem(project, mapping, t, { parentKey: parent })) }) }) });
    actions.push({ id: "undo", label: "Undo", hint: "Ctrl Z", run: () => { undo(); onClose(); } });
    actions.push({ id: "redo", label: "Redo", hint: "Ctrl Shift Z", run: () => { redo(); onClose(); } });
  }
  for (const v of views) actions.push({ id: `go-${v.id}`, label: `Go to ${v.label}`, run: () => { go(v.id); onClose(); } });
  actions.push({ id: "go-review", label: "Go to Review changes", hint: "before they are applied", run: () => { go("review"); onClose(); } });
  actions.push({ id: "ghonly", label: "Toggle “GitHub only”", run: () => { toggleGithubOnly(); onClose(); } });

  // A sentence, if it is one. A sentence that works sits at the top of the list, whatever
  // else was typed; one that needs to know which item it meant waits at the end.
  const said = phrase ?? (guessed ? { intent: guessed, text: query } : null);
  if (said) {
    const result = intentOps(project, mapping, said.intent, schedule ?? buildSchedule(project, mapping, emptyDraft()));
    if (result.question) {
      const slot = phrase?.missing?.slot ?? "target";
      const candidates = findTargets(project, mapping, slotPhrase(said.intent, slot), 6);
      actions.push({
        id: "phrase-ask", label: result.question, hint: query,
        run: () => { speak?.(result.question!); setStep({
          kind: "phrase", title: result.question!, intent: said.intent, slot,
          options: candidates.map(c => ({ value: c.title, label: c.title, hint: c.kind === "epic" ? "epic" : undefined })),
        }); },
      });
    } else if (result.ops.length) {
      actions.unshift({
        id: "phrase-do", label: result.label, hint: phrase ? "from what you said" : "read by the model", pinned: true,
        run: () => { speak?.(result.label); run(result.label, result.ops); },
      });
    }
  }

  return (
    <div className="modal cmdk-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command menu">
        <div className="cmdk-head">
          {step ? <><button className="linkbtn" onClick={() => setStep(null)}>← Back</button><b>{step.title}</b></>
            : <span className="muted">{n ? `${n} selected` : "Nothing selected: Ctrl-click rows in Gantt, or tick rows in Plan"}</span>}
        </div>
        {!step && (
          <>
            <PickList options={actions.map(a => ({ value: a.id, label: a.label, hint: a.hint, pinned: a.pinned }))} placeholder="Type a command, or say what you want…"
              value={query} onQuery={setQuery} onPick={id => actions.find(a => a.id === id)?.run()} />
            {local?.enabled && (
              <div className="cmdk-mic">
                <button className={`btn small ${dictation.listening ? "primary" : ""}`} onClick={dictation.toggle} disabled={dictation.working}
                  title={dictation.listening ? "Stop listening" : "Say it instead of typing it"}>
                  {dictation.listening ? "◼ Listening…" : dictation.working ? "…" : "🎤"}
                </button>
                {dictation.error && <span className="muted">{dictation.error}</span>}
              </div>
            )}
          </>
        )}
        {step?.kind === "list" && <PickList key={step.title} options={step.options} placeholder={`Find ${step.title.toLowerCase()}…`} onPick={step.onPick} />}
        {step?.kind === "text" && <TextStep step={step} />}
        {step?.kind === "phrase" && <PhraseStep step={step} project={project} mapping={mapping} schedule={schedule} onDone={run} onSpeak={speak} />}
      </div>
    </div>
  );
}

/** Which item did the sentence mean? Then it does it. */
function PhraseStep({ step, project, mapping, schedule, onDone, onSpeak }: {
  step: Extract<Step, { kind: "phrase" }>;
  project: Project; mapping: Mapping; schedule?: Schedule;
  onDone: (label: string, ops: Op[]) => void;
  onSpeak?: (text: string) => void;
}) {
  return (
    <>
      <PickList options={step.options} placeholder="Which one?" onPick={title => {
        const intent = fillSlot(step.intent, step.slot, title);
        const result = intentOps(project, mapping, intent, schedule ?? buildSchedule(project, mapping, emptyDraft()));
        if (result.question) { onSpeak?.(result.question); return; }
        onDone(result.label, result.ops);
      }} />
    </>
  );
}

function TextStep({ step }: { step: Extract<Step, { kind: "text" }> }) {
  const [t, setT] = useState("");
  return (
    <form onSubmit={e => { e.preventDefault(); if (t.trim()) step.onSubmit(t.trim()); }} style={{ display: "flex", gap: 8 }}>
      <input className="input" style={{ fontFamily: "var(--f-body)" }} autoFocus placeholder={step.placeholder} aria-label={step.placeholder} value={t} onChange={e => setT(e.target.value)} />
      <button className="btn primary" type="submit" disabled={!t.trim()}>Add</button>
    </form>
  );
}
