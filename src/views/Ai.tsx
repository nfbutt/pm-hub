// Setting up the AI, step by step.
//
// The problem this solves: pm-hub needs a model, and a model needs three things — a
// server running, a chat model on it, and an embedding model on it — and each of them
// fails in a different way, quietly. So this view asks the server what it has, says
// what each model is for, and gives the exact command when something is missing.
import { useEffect, useState } from "react";
import {
  DEFAULT_CONTEXT, DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT, DEFAULT_VOICE_BASE, DEFAULT_VOICE_MODEL,
  defaultLocal, forgetModels, serverStatus, testModel, type LocalSettings, type ModelCheck,
} from "../ai/local";
import { listVoiceModels, testSpeech, type SpeechCheck } from "../ai/voice";
import { describeModel, recommendModels } from "../ai/recommend";
import { keyIsRemembered, readApiKey, writeApiKey } from "../store/key";
import type { Prefs } from "../store/cache";

/** The commands a person needs, in the order they need them. */
const OLLAMA_START = "ollama serve";
const OLLAMA_PULL_CHAT = "ollama pull qwen2.5:7b";
const OLLAMA_PULL_EMBED = "ollama pull qwen3-embedding:0.6b";
const SPEACHES_START = "docker run -p 8000:8000 ghcr.io/speaches-ai/speaches:latest-cpu";

export function Ai({ prefs, setPrefs }: { prefs: Prefs; setPrefs: (p: Prefs) => void }) {
  const local = prefs.local ?? defaultLocal;
  const setLocal = (patch: Partial<LocalSettings>) => setPrefs({ ...prefs, local: { ...local, ...patch } });
  const [key, setKey] = useState(() => readApiKey() ?? "");
  const [remember, setRemember] = useState(() => keyIsRemembered());
  const [server, setServer] = useState<{ there: boolean; models: string[]; message: string } | null>(null);
  const [looking, setLooking] = useState(false);
  const [check, setCheck] = useState<ModelCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [speech, setSpeech] = useState<SpeechCheck | null>(null);
  const [speechModels, setSpeechModels] = useState<string[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  /** Ask the server what it has. */
  async function look() {
    setLooking(true);
    forgetModels();
    setServer(await serverStatus(local));
    setLooking(false);
  }

  // On arriving: find out where things stand, so the first thing on the page is the
  // answer rather than a form.
  useEffect(() => { void look(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [local.base, local.allowRemote]);

  async function test() {
    setChecking(true);
    setCheck(null);
    const result = await testModel(local);
    setCheck(result);
    setChecking(false);
  }

  async function lookForSpeech() {
    const found = await listVoiceModels(local.voiceBase ?? DEFAULT_VOICE_BASE);
    setSpeechModels(found ?? []);
    setSpeech(await testSpeech(local));
  }

  const rec = server?.models.length ? recommendModels(server.models) : null;
  const hosted = !!local.allowRemote;

  async function copy(text: string) {
    try { await navigator.clipboard?.writeText(text); setCopied(text); setTimeout(() => setCopied(null), 1500); } catch { /* no clipboard */ }
  }

  return (
    <div className="narrow" style={{ display: "grid", gap: 16, maxWidth: 820 }}>
      <div className="section-h">
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Set up the AI</h1>
          <p className="muted" style={{ maxWidth: "70ch" }}>
            pm-hub can read your plan with a model on your own computer, or one you have paid for. Nothing is sent
            anywhere until you say so, and nothing a model says is applied without your say-so.
          </p>
        </div>
      </div>

      <section className="card pad settings">
        <h2>1 · Where does the model run?</h2>
        <div className="seg" role="group" aria-label="Where the model runs" style={{ justifySelf: "start" }}>
          <button className={hosted ? "" : "on"} onClick={() => { forgetModels(); setLocal({ base: "http://localhost:11434/v1", allowRemote: false }); }}>On this computer</button>
          <button className={hosted ? "on" : ""} onClick={() => { forgetModels(); setLocal({ base: "https://openrouter.ai/api/v1", allowRemote: false, chatModel: "qwen/qwen3.5-flash-02-23" }); }}>OpenRouter</button>
        </div>
        <div className="setting">
          <label htmlFor="ai-base">Address</label>
          <input id="ai-base" className="input" value={local.base} onChange={e => { forgetModels(); setLocal({ base: e.target.value }); }}
            placeholder="http://localhost:11434/v1" />
          <span className="muted">
            {hosted
              ? "An OpenAI-compatible endpoint that runs somewhere else."
              : "An OpenAI-compatible endpoint on this computer: Ollama, LM Studio, llama.cpp."}
          </span>
        </div>
        {hosted && (
          <>
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
            <label className="check-row">
              <input type="checkbox" checked={!!local.allowRemote} onChange={e => setLocal({ allowRemote: e.target.checked })} />
              <span>
                <b>I understand this model runs somewhere else.</b> The text of my issues — titles and bodies — is sent to{" "}
                <code>{local.base.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}</code> to be read, along with the questions I ask it.
                Nothing else goes: never my GitHub token, never a repository, never the plan history.
              </span>
            </label>
          </>
        )}
      </section>

      <section className="card pad settings">
        <h2>2 · Is it there?</h2>
        <div className="drow">
          <button className="btn" onClick={() => void look()} disabled={looking}>{looking ? "Looking…" : "Ask the server"}</button>
          {server && <span className={server.there ? "good" : "bad"}>{server.message}</span>}
        </div>
        {!hosted && !server?.there && (
          <div className="callout info" style={{ display: "grid", gap: 8 }}>
            <b>Start Ollama, then give it a model.</b>
            <span className="muted">Two commands, in a terminal. The first starts the server; the second downloads a model.</span>
            <Command text={OLLAMA_START} onCopy={copy} copied={copied === OLLAMA_START} />
            <Command text={OLLAMA_PULL_CHAT} onCopy={copy} copied={copied === OLLAMA_PULL_CHAT} />
            <Command text={OLLAMA_PULL_EMBED} onCopy={copy} copied={copied === OLLAMA_PULL_EMBED} />
            <span className="muted">
              The first model writes; the second turns text into vectors, so the map can compare by meaning rather than by
              words. <a href="https://ollama.com/download" target="_blank" rel="noreferrer">Get Ollama</a> if you do not have it.
            </span>
          </div>
        )}
      </section>

      <section className="card pad settings">
        <h2>3 · Which model?</h2>
        {!server?.models.length ? (
          <p className="muted">
            {hosted
              ? "Ask the server above for its models. A hosted service has hundreds, so pm-hub picks the one it thinks is right."
              : "The models the server has will appear here."}
          </p>
        ) : (
          <>
            <p className="muted" style={{ maxWidth: "70ch" }}>
              Pick the model that writes, and the one that finds meaning. Or let pm-hub choose:{" "}
              <button className="linkbtn" onClick={() => {
                if (!rec) return;
                setLocal({ chatModel: rec.chat ?? local.chatModel, embedModel: rec.embed ?? local.embedModel, enabled: true });
              }}>use the ones I would pick</button>
              {rec?.why && <> — {rec.why}</>}
            </p>
            <ul className="emap-list" style={{ display: "grid", gap: 6 }}>
              {server.models.map(id => {
                const note = describeModel(id);
                const isChat = local.chatModel === id;
                const isEmbed = local.embedModel === id;
                return (
                  <li key={id} style={{ display: "grid", gap: 2 }}>
                    <span style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <code>{id}</code>
                      {note.kind === "embedding"
                        ? <button className="linkbtn" onClick={() => setLocal({ embedModel: id, enabled: true })}>{isEmbed ? "✓ in use" : "use for meaning"}</button>
                        : <button className="linkbtn" onClick={() => setLocal({ chatModel: id, enabled: true })}>{isChat ? "✓ in use" : "use to write"}</button>}
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>{note.note}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="setting">
          <label htmlFor="ai-chat">Chat model</label>
          <input id="ai-chat" className="input" value={local.chatModel} onChange={e => setLocal({ chatModel: e.target.value })} />
        </div>
        <div className="setting">
          <label htmlFor="ai-embed">Embedding model</label>
          <input id="ai-embed" className="input" value={local.embedModel} onChange={e => setLocal({ embedModel: e.target.value })} />
          <span className="muted">Without one, the map compares by words rather than by meaning.</span>
        </div>
      </section>

      <section className="card pad settings">
        <h2>4 · The microphone (optional)</h2>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          Speaking needs its own server — the chat model does not transcribe. The recording goes to that server on this
          computer and nowhere else.
        </p>
        <div className="setting">
          <label htmlFor="ai-voice">Speech server</label>
          <input id="ai-voice" className="input" value={local.voiceBase ?? DEFAULT_VOICE_BASE} onChange={e => setLocal({ voiceBase: e.target.value })} />
        </div>
        <div className="setting">
          <label htmlFor="ai-voice-model">Speech model</label>
          <input id="ai-voice-model" className="input" value={local.voiceModel ?? DEFAULT_VOICE_MODEL}
            onChange={e => setLocal({ voiceModel: e.target.value })} />
          <span className="muted">
            These servers call their models by their full name, such as <code>Systran/faster-whisper-base</code>. If the
            name is not one the server has, pm-hub uses one it does have.
          </span>
        </div>
        <div className="drow">
          <button className="btn" onClick={() => void lookForSpeech()}>What speech models does it have?</button>
          {speechModels && speechModels.length > 0 && (
            <span className="muted" style={{ fontSize: 12 }}>
              {speechModels.map(id => (
                <span key={id} style={{ marginRight: 10, whiteSpace: "nowrap" }}>
                  <code>{id}</code>{" "}
                  <button className="linkbtn" onClick={() => setLocal({ voiceModel: id })}>use</button>
                </span>
              ))}
            </span>
          )}
        </div>
        {speech && (
          <p className={speech.ok ? "good" : "bad"}>
            {speech.message}
            {speech.fix && <><br /><span className="muted">{speech.fix}</span></>}
          </p>
        )}
        {!speech && (
          <div className="callout info" style={{ display: "grid", gap: 8 }}>
            <b>No speech server yet?</b>
            <span className="muted">One command, if you have Docker. It also needs a speech model before it can transcribe.</span>
            <Command text={SPEACHES_START} onCopy={copy} copied={copied === SPEACHES_START} />
            <Command text={`curl -X POST http://localhost:8000/v1/models/Systran/faster-whisper-base -H 'Content-Type: application/json' -d '{"type": "speech-to-text"}'`}
              onCopy={copy} copied={copied?.startsWith("curl") ?? false} />
          </div>
        )}
      </section>

      <section className="card pad settings">
        <h2>5 · Does it work?</h2>
        <label className="check-row">
          <input type="checkbox" checked={local.enabled} onChange={e => setLocal({ enabled: e.target.checked })} />
          Use the model for the Epic Map, the planner and the roadmap
        </label>
        <div className="drow">
          <button className="btn primary" onClick={() => void test()} disabled={checking}>{checking ? "Testing…" : "Test the connection"}</button>
        </div>
        {check && (
          <p className={check.ok ? "good" : "bad"}>
            {check.message}
            {check.fix && <><br /><span className="muted">{check.fix}</span></>}
          </p>
        )}
        <details>
          <summary className="muted" style={{ cursor: "pointer" }}>The knobs, if you need them</summary>
          <div className="setting">
            <label htmlFor="ai-budget">How many tokens the model may use</label>
            <input id="ai-budget" className="input" type="number" min={256} max={32000} step={256} value={local.maxTokens ?? DEFAULT_MAX_TOKENS}
              onChange={e => setLocal({ maxTokens: Math.max(256, Math.min(32000, Number(e.target.value) || DEFAULT_MAX_TOKENS)) })} />
            <span className="muted">A thinking model can spend the whole budget thinking and never answer.</span>
          </div>
          <div className="setting">
            <label htmlFor="ai-context">How much context the model gets</label>
            <input id="ai-context" className="input" type="number" min={2048} max={131072} step={2048} value={local.contextTokens ?? DEFAULT_CONTEXT}
              onChange={e => setLocal({ contextTokens: Math.max(2048, Math.min(131072, Number(e.target.value) || DEFAULT_CONTEXT)) })} />
            <span className="muted">Ollama's own default is 4096, which is not much room for a plan.</span>
          </div>
          <div className="setting">
            <label htmlFor="ai-timeout">How long to wait for the model</label>
            <input id="ai-timeout" className="input" type="number" min={5} max={900} value={local.timeoutSeconds ?? DEFAULT_TIMEOUT}
              onChange={e => setLocal({ timeoutSeconds: Math.max(5, Math.min(900, Number(e.target.value) || DEFAULT_TIMEOUT)) })} />
            <span className="muted">Seconds. A model on this computer can take minutes.</span>
          </div>
        </details>
      </section>
    </div>
  );
}

/** A command to copy, so nobody has to type it. */
function Command({ text, onCopy, copied }: { text: string; onCopy: (t: string) => void; copied: boolean }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <code style={{ background: "var(--surface-2)", padding: "6px 10px", borderRadius: 8, fontSize: 13 }}>{text}</code>
      <button className="btn small" onClick={() => onCopy(text)}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}
