// Whether the AI is there. A pill in the top bar that says so at a glance, and opens a
// panel that checks the connection and says what to do about it.
import { useEffect, useRef, useState } from "react";
import { testModel, type LocalSettings, type ModelCheck } from "../../ai/local";
import { about, FRESH_MS, readCheck, writeCheck } from "./checkCache";
import { testSpeech, type SpeechCheck } from "../../ai/voice";

export function AiStatus({ settings, settingsHref }: { settings: LocalSettings; settingsHref: string }) {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<ModelCheck | null>(() => readCheck(settings)?.check ?? null);
  const [checkedAt, setCheckedAt] = useState(() => readCheck(settings)?.at ?? 0);
  const [speech, setSpeech] = useState<SpeechCheck | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // A check of one setup says nothing about another: when the setup page changes the
  // address or a model, the pill goes back to what is known about the new one.
  const setup = about(settings);
  useEffect(() => {
    const cached = readCheck(settings);
    setCheck(cached?.check ?? null);
    setCheckedAt(cached?.at ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener("keydown", onKey);
    addEventListener("mousedown", onClick);
    return () => { removeEventListener("keydown", onKey); removeEventListener("mousedown", onClick); };
  }, [open]);

  async function run() {
    setChecking(true);
    const result = await testModel(settings);
    setCheck(result);
    setCheckedAt(Date.now());
    writeCheck(result, settings);
    // The microphone needs a different program, so it is checked on its own.
    setSpeech(await testSpeech(settings));
    setChecking(false);
  }

  // The panel is open, so what it says had better be true now.
  useEffect(() => {
    if (!open) return;
    if (!checkedAt || Date.now() - checkedAt > FRESH_MS) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Off, ready, or something to look at.
  const state = !settings.enabled ? "off" : check ? (check.ok ? "on" : "bad") : "unknown";
  const label = state === "off" ? "AI off" : state === "on" ? "AI ready" : state === "bad" ? "AI not answering" : "AI on";

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button className={`btn ai-pill ${state}`} onClick={() => setOpen(o => !o)}
        aria-expanded={open} title="Is the model working?">
        <span className="ai-dot" aria-hidden="true" /> {label}{settings.allowRemote ? " · hosted" : ""}
      </button>
      {open && (
        <div className="ai-panel" role="dialog" aria-label="AI connection">
          <h3>AI on this computer</h3>
          {state === "off" && (
            <>
              <p className="muted">
                It is off. Setting it up is three things: a model server running, a model to write with, and a model to
                find meaning with. The setup page checks each one and gives you the command when one is missing.
              </p>
              <a className="btn primary" href={settingsHref}>Set up the AI</a>
            </>
          )}
          {state !== "off" && (
            <>
              <p className="muted">
                {settings.base} · {settings.chatModel} · {settings.embedModel}
              </p>
              {check && (
                <p className={check.ok ? "good" : "bad"}>
                  {check.message}
                  {check.fix && <><br /><span className="muted">{check.fix}</span></>}
                </p>
              )}
              {speech && (
                <p className={speech.ok ? "muted" : "bad"}>
                  <b>Microphone:</b> {speech.message}
                  {speech.fix && <><br /><span className="muted">{speech.fix}</span></>}
                </p>
              )}
              <div className="ai-actions">
                <button className="btn" onClick={() => void run()} disabled={checking}>{checking ? "Checking…" : "Test the connection"}</button>
                <a className="btn ghost" href={settingsHref}>Set up the AI</a>
              </div>
              {!check && <p className="muted" style={{ fontSize: 12 }}>Nothing has been checked yet.</p>}
            </>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {settings.allowRemote
              ? <>This model runs somewhere else. It reads the text of your issues — never your GitHub token, never a repository, never the plan history.</>
              : <>Everything stays on this computer. pm-hub never sends anything to a hosted service.</>}
          </p>
        </div>
      )}
    </div>
  );
}
