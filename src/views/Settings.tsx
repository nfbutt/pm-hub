import { labelPrefixes, type LaneRule, type Mapping, type ReleaseRule } from "../model/mapping";
import type { Project } from "../model/normalize";
import type { Prefs } from "../store/cache";
import {
  DEFAULT_CONTEXT, DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT, DEFAULT_VOICE_BASE, DEFAULT_VOICE_MODEL, defaultLocal, forgetModels, listModels, testModel, type ModelCheck,
} from "../ai/local";
import { useState } from "react";
import { listVoiceModels } from "../ai/voice";
import { keyIsRemembered, readApiKey, writeApiKey } from "../store/key";
import type { ReactNode } from "react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** 0 is Sunday. */
const DAYS: [number, string][] = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];

export function Settings({ project, mapping, setMapping, resetMapping, prefs, setPrefs, extra }: {
  project: Project; mapping: Mapping; setMapping: (m: Mapping) => void; resetMapping: () => void; prefs: Prefs; setPrefs: (p: Prefs) => void;
  /** More sections (history) rendered at the end. */
  extra?: ReactNode;
}) {
  const names = (kind: string) => project.fields.filter(f => f.kind === kind).map(f => f.name);
  const dates = names("date"), singles = names("single"), iterations = names("iteration");
  const prefixes = [...labelPrefixes(project).entries()].filter(([, v]) => v.size >= 2).map(([k]) => k).sort();
  const epicLabels = [...new Set(project.items.flatMap(i => i.labels))].filter(l => /epic/i.test(l)).sort();
  const issueTypes = [...new Set(project.items.map(i => i.issueType).filter((t): t is string => !!t))].sort();
  const set = (patch: Partial<Mapping>) => setMapping({ ...mapping, ...patch });
  const workingDays = mapping.workingDays?.length ? mapping.workingDays : [1, 2, 3, 4, 5];
  const holidays = mapping.holidays ?? [];
  const local = prefs.local ?? defaultLocal;
  const setLocal = (patch: Partial<typeof local>) => setPrefs({ ...prefs, local: { ...local, ...patch } });
  const [key, setKey] = useState(() => readApiKey() ?? "");
  const [remember, setRemember] = useState(() => keyIsRemembered());
  const [probe, setProbe] = useState<ModelCheck | null>(null);
  const [probing, setProbing] = useState(false);
  // The models the server actually has. The names are not always what you would guess,
  // so it is better to ask than to remember.
  const [installed, setInstalled] = useState<string[] | null>(null);
  const [listing, setListing] = useState(false);
  const findModels = async () => {
    setListing(true);
    forgetModels();
    const found = await listModels(local);
    setInstalled(found);
    setListing(false);
  };
  // The speech models the server has, which are named nothing like "whisper-1".
  const [voiceModels, setVoiceModels] = useState<string[] | null>(null);
  const [listingVoice, setListingVoice] = useState(false);
  const findVoiceModels = async () => {
    setListingVoice(true);
    const found = await listVoiceModels(local.voiceBase ?? DEFAULT_VOICE_BASE);
    setVoiceModels(found ?? []);
    setListingVoice(false);
  };
  const probeConnection = async () => {
    setProbing(true);
    setProbe(null);
    const result = await testModel(local);
    setProbe(result);
    setProbing(false);
  };

  const laneValue = mapping.lane.kind === "field" ? `field:${mapping.lane.field}` : mapping.lane.kind === "labelPrefix" ? `prefix:${mapping.lane.prefix}` : "none";
  const releaseValue = mapping.release.kind === "milestone" ? "milestone" : mapping.release.kind === "iteration" ? `iteration:${mapping.release.field}`
    : mapping.release.kind === "field" ? `field:${mapping.release.field}` : "none";
  const prioValue = mapping.priority.kind === "field" ? `field:${mapping.priority.field}` : mapping.priority.kind === "labelPrefix" ? `prefix:${mapping.priority.prefix}` : "none";

  const parseLane = (v: string): LaneRule => v.startsWith("field:") ? { kind: "field", field: v.slice(6) } : v.startsWith("prefix:") ? { kind: "labelPrefix", prefix: v.slice(7) } : { kind: "none" };
  const parseRelease = (v: string): ReleaseRule => v === "milestone" ? { kind: "milestone" } : v.startsWith("iteration:") ? { kind: "iteration", field: v.slice(10) }
    : v.startsWith("field:") ? { kind: "field", field: v.slice(6) } : { kind: "none" };

  const Select = ({ id, label, value, onChange, options, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][]; hint?: string }) => (
    <div className="setting">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={e => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hint && <span className="muted">{hint}</span>}
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 860 }}>
      <div className="section-h">
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>How this project is read</h1>
          <p className="muted">These were detected automatically. Changes are saved in this browser for this project only.</p>
        </div>
        <button className="btn" onClick={resetMapping}>Detect again</button>
      </div>

      <section className="card pad settings">
        <h2>Bars</h2>
        <Select id="m-start" label="Start date field" value={mapping.startField ?? ""} onChange={v => set({ startField: v || null })}
          options={[["", "None"], ...dates.map(d => [d, d] as [string, string])]} />
        <Select id="m-end" label="End date field" value={mapping.endField ?? ""} onChange={v => set({ endField: v || null })}
          options={[["", "None"], ...dates.map(d => [d, d] as [string, string])]} />
        <Select id="m-iter" label="Iteration fallback" value={mapping.iterationField ?? ""} onChange={v => set({ iterationField: v || null })}
          options={[["", "None"], ...iterations.map(d => [d, d] as [string, string])]} hint="Used for items without dates." />
        <label className="check-row"><input id="m-ms" type="checkbox" checked={mapping.milestoneDates} onChange={e => set({ milestoneDates: e.target.checked })} />
          Use the milestone due date when nothing else is set</label>
      </section>

      <section className="card pad settings">
        <h2>Epics</h2>
        <label className="check-row"><input id="m-subs" type="checkbox" checked={mapping.epic.subIssues} onChange={e => set({ epic: { ...mapping.epic, subIssues: e.target.checked } })} />
          Any issue with sub-issues is an epic</label>
        <Select id="m-elabel" label="Label that marks an epic" value={mapping.epic.label ?? ""} onChange={v => set({ epic: { ...mapping.epic, label: v || null } })}
          options={[["", "None"], ...epicLabels.map(l => [l, l] as [string, string])]} />
        {issueTypes.length > 0 && (
          <fieldset className="setting">
            <legend>Issue types that are epics</legend>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {issueTypes.map(t => (
                <label key={t} className="check-row"><input type="checkbox" checked={mapping.epic.issueTypes.includes(t)}
                  onChange={e => set({ epic: { ...mapping.epic, issueTypes: e.target.checked ? [...mapping.epic.issueTypes, t] : mapping.epic.issueTypes.filter(x => x !== t) } })} /> {t}</label>
              ))}
            </div>
          </fieldset>
        )}
      </section>

      <section className="card pad settings">
        <h2>Grouping</h2>
        <Select id="m-lane" label="Swimlanes" value={laneValue} onChange={v => set({ lane: parseLane(v) })}
          options={[["none", "None"], ...singles.map(s => [`field:${s}`, `Field: ${s}`] as [string, string]), ...prefixes.map(p => [`prefix:${p}`, `Labels starting “${p}:”`] as [string, string])]} />
        <Select id="m-rel" label="Releases" value={releaseValue} onChange={v => set({ release: parseRelease(v) })}
          options={[["none", "None"], ["milestone", "Milestones"], ...iterations.map(s => [`iteration:${s}`, `Iteration: ${s}`] as [string, string]), ...singles.map(s => [`field:${s}`, `Field: ${s}`] as [string, string])]} />
        <Select id="m-status" label="Status field" value={mapping.statusField ?? ""} onChange={v => set({ statusField: v || null })}
          options={[["", "None"], ...singles.map(s => [s, s] as [string, string])]} />
        <Select id="m-reldue" label="Release due date" value={mapping.releaseDueField ?? ""} onChange={v => set({ releaseDueField: v || null })}
          options={[["", "None"], ...dates.map(d => [d, d] as [string, string])]} hint="The date field that says when a release is due." />
        <Select id="m-prio" label="Priority" value={prioValue}
          onChange={v => set({ priority: v.startsWith("field:") ? { kind: "field", field: v.slice(6) } : v.startsWith("prefix:") ? { kind: "labelPrefix", prefix: v.slice(7) } : { kind: "none" } })}
          options={[["none", "None"], ...singles.map(s => [`field:${s}`, `Field: ${s}`] as [string, string]), ...prefixes.map(p => [`prefix:${p}`, `Labels starting “${p}:”`] as [string, string])]} />
      </section>

      <section className="card pad settings">
        <h2>Calendar</h2>
        <Select id="p-fy" label="Fiscal year starts in" value={String(prefs.fyStartMonth)} onChange={v => setPrefs({ ...prefs, fyStartMonth: Number(v) })}
          options={MONTHS.map((m, i) => [String(i + 1), i === 0 ? "January (calendar year)" : i === 9 ? "October (US federal)" : m] as [string, string])}
          hint="Changes the quarter labels on the timeline. Applies to every project." />
        <fieldset className="setting">
          <legend>Working days</legend>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {DAYS.map(([i, name]) => (
              <label key={name} className="check-row">
                <input type="checkbox" checked={workingDays.includes(i)}
                  onChange={e => setMapping({ ...mapping, workingDays: e.target.checked ? [...workingDays, i].sort() : workingDays.filter(d => d !== i) })} />
                {name}
              </label>
            ))}
          </div>
          <span className="muted">Days nobody works in are shaded on the chart, and the plan does not count them.</span>
        </fieldset>
        <div className="setting">
          <label htmlFor="m-holidays">Holidays</label>
          <input id="m-holidays" className="input" value={holidays.join(", ")} placeholder="2026-12-25, 2027-01-01"
            onChange={e => setMapping({ ...mapping, holidays: e.target.value.split(",").map(d => d.trim()).filter(Boolean) })} />
          <span className="muted">Days that are not working days, whatever the week says.</span>
        </div>
      </section>

      <section className="card pad settings">
        <h2>Local model</h2>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          A model can help the Epic Map compare work by meaning, explain what it sees, and draft a plan. Only issue
          titles and bodies are sent, and your GitHub token is never part of a request.
        </p>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          <b>One thing worth knowing:</b> a thinking model (qwen3 and its family) can spend minutes filling its context
          before it answers, and a plan is exactly the kind of thing it overthinks. A model that answers straight away —
          qwen2.5, for one — is usually the better choice here, and the test button below will tell you how long yours took.
        </p>
        <label className="check-row">
          <input type="checkbox" checked={local.enabled} onChange={e => setLocal({ enabled: e.target.checked })} />
          Use a local model for the Epic Map
        </label>
        <div className="seg" role="group" aria-label="Where the model runs" style={{ justifySelf: "start" }}>
          <button className={local.allowRemote ? "" : "on"} onClick={() => { forgetModels(); setLocal({ base: "http://localhost:11434/v1", allowRemote: false }); }}>
            On this computer
          </button>
          <button className={local.allowRemote ? "on" : ""} onClick={() => { forgetModels(); setLocal({ base: "https://openrouter.ai/api/v1", allowRemote: false, chatModel: "qwen/qwen3.5-flash-02-23" }); }}>
            OpenRouter
          </button>
        </div>
        <div className="setting">
          <label htmlFor="ai-base">Address</label>
          <input id="ai-base" className="input" value={local.base} onChange={e => { forgetModels(); setLocal({ base: e.target.value }); }}
            placeholder="http://localhost:11434/v1" />
          <span className="muted">An OpenAI-compatible endpoint, e.g. Ollama or LM Studio.</span>
        </div>
        {local.allowRemote && (
          <div className="setting">
            <label htmlFor="ai-key">API key</label>
            <input id="ai-key" className="input" type="password" value={key} placeholder="sk-or-…"
              onChange={e => setKey(e.target.value)} />
            <label className="check-row">
              <input type="checkbox" checked={remember} onChange={e => { setRemember(e.target.checked); writeApiKey(key, e.target.checked); }} />
              Remember on this device
            </label>
            <span className="muted">Kept out of your preferences and out of the shared plan history. Not remembered means this tab only.</span>
          </div>
        )}
        {!local.allowRemote ? (
          <p className="muted" style={{ maxWidth: "70ch" }}>
            Everything stays on this computer: pm-hub never sends anything to a hosted service.
          </p>
        ) : (
          <div className="callout warn" style={{ maxWidth: "70ch" }}>
            <b>This model runs somewhere else.</b> The text of your issues — titles and bodies — is sent to
            {" "}<code>{local.base.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}</code> to be read, and so are the
            questions you ask it. Nothing else goes: never your GitHub token, never a repository, never the history.
            {local.embedModel && <><br />Note that this service has no embedding model, so the map will compare by words rather than by meaning.</>}
          </div>
        )}
        <div className="setting">
          <label htmlFor="ai-chat">Chat model</label>
          <input id="ai-chat" className="input" value={local.chatModel} onChange={e => setLocal({ chatModel: e.target.value })} />
        </div>
        <div className="drow">
          <button className="btn" onClick={() => void findModels()} disabled={listing}>{listing ? "Looking…" : "What does the server have?"}</button>
          {installed && installed.length > 0 && (
            <span className="muted" style={{ fontSize: 12 }}>
              {installed.map(id => (
                <span key={id} style={{ marginRight: 10, whiteSpace: "nowrap" }}>
                  <code>{id}</code>{" "}
                  <button className="linkbtn" onClick={() => setLocal({ chatModel: id })}>chat</button>{" "}
                  <button className="linkbtn" onClick={() => setLocal({ embedModel: id })}>embeddings</button>
                </span>
              ))}
            </span>
          )}
          {installed && !installed.length && <span className="muted" style={{ fontSize: 12 }}>Nothing answered on that address.</span>}
        </div>
        <div className="setting">
          <label htmlFor="ai-budget">How many tokens the model may use</label>
          <input id="ai-budget" className="input" type="number" min={256} max={32000} step={256} value={local.maxTokens ?? DEFAULT_MAX_TOKENS}
            onChange={e => setLocal({ maxTokens: Math.max(256, Math.min(32000, Number(e.target.value) || DEFAULT_MAX_TOKENS)) })} />
          <span className="muted">A thinking model (qwen3 and its family) can spend the whole budget thinking and never answer. Give it more, or use a model that answers straight away.</span>
        </div>
        <div className="setting">
          <label htmlFor="ai-context">How much context the model gets</label>
          <input id="ai-context" className="input" type="number" min={2048} max={131072} step={2048} value={local.contextTokens ?? DEFAULT_CONTEXT}
            onChange={e => setLocal({ contextTokens: Math.max(2048, Math.min(131072, Number(e.target.value) || DEFAULT_CONTEXT)) })} />
          <span className="muted">Ollama's own default is 4096, which is not much room for a plan and the thinking that goes with it.</span>
        </div>
        <div className="setting">
          <label htmlFor="ai-timeout">How long to wait for the model</label>
          <input id="ai-timeout" className="input" type="number" min={5} max={900} value={local.timeoutSeconds ?? DEFAULT_TIMEOUT}
            onChange={e => setLocal({ timeoutSeconds: Math.max(5, Math.min(900, Number(e.target.value) || DEFAULT_TIMEOUT)) })} />
          <span className="muted">Seconds. A model on this computer can take minutes: a thinking model fills its context before it answers.</span>
        </div>
        <div className="setting">
          <label htmlFor="ai-embed">Embedding model</label>
          <input id="ai-embed" className="input" value={local.embedModel} onChange={e => setLocal({ embedModel: e.target.value })} />
        </div>
        <div className="setting">
          <label htmlFor="ai-voice">Speech server</label>
          <input id="ai-voice" className="input" value={local.voiceBase ?? DEFAULT_VOICE_BASE} onChange={e => setLocal({ voiceBase: e.target.value })} />
          <span className="muted">
            A separate server for turning speech into text, such as Speaches. The chat model usually cannot do it.
            The microphone in the top bar sends your voice there, and nowhere else.
          </span>
        </div>
        <div className="setting">
          <label htmlFor="ai-voice-model">Speech model</label>
          <input id="ai-voice-model" className="input" value={local.voiceModel ?? DEFAULT_VOICE_MODEL}
            onChange={e => setLocal({ voiceModel: e.target.value })} />
          <span className="muted">
            Speaches calls these by their full name, such as <code>Systran/faster-whisper-base</code>, not
            <code> whisper-1</code>. If the name is not one the server has, pm-hub uses one it does have.
          </span>
        </div>
        <div className="drow">
          <button className="btn" onClick={() => void findVoiceModels()} disabled={listingVoice}>
            {listingVoice ? "Looking…" : "What speech models does it have?"}
          </button>
          {voiceModels && voiceModels.length > 0 && (
            <span className="muted" style={{ fontSize: 12 }}>
              {voiceModels.map(id => (
                <span key={id} style={{ marginRight: 10, whiteSpace: "nowrap" }}>
                  <code>{id}</code>{" "}
                  <button className="linkbtn" onClick={() => setLocal({ voiceModel: id })}>use</button>
                </span>
              ))}
            </span>
          )}
          {voiceModels && !voiceModels.length && <span className="muted" style={{ fontSize: 12 }}>Nothing answered there, or it has no speech model yet.</span>}
        </div>
        <div className="drow">
          <button className="btn primary" onClick={probeConnection} disabled={probing}>{probing ? "Testing…" : "Test the connection"}</button>
        </div>
        {probe && (
          <p className={probe.ok ? "callout info" : "callout bad"}>
            {probe.message}
            {probe.fix && <><br /><span className="muted">{probe.fix}</span></>}
          </p>
        )}
      </section>
      {extra}
    </div>
  );
}
