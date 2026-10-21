// Whether the AI is there. A pill in the top bar that says so at a glance, and opens a
// panel that checks the connection and says what to do about it.
import { useEffect, useRef, useState } from "react";
import { testModel, type LocalSettings, type ModelCheck } from "../../ai/local";
import { testSpeech, type SpeechCheck } from "../../ai/voice";

const LAST_CHECK = "pm-hub:ai-check";

interface Cached { at: number; check: ModelCheck }

/** The last check, so the pill does not ask the model again on every page. */
function cached(): Cached | null {
  try { return JSON.parse(localStorage.getItem(LAST_CHECK) ?? "null"); } catch { return null; }
}
function remember(check: ModelCheck) {
  try { localStorage.setItem(LAST_CHECK, JSON.stringify({ at: Date.now(), check } satisfies Cached)); } catch { /* optional */ }
}

export function AiStatus({ settings, settingsHref }: { settings: LocalSettings; settingsHref: string }) {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<ModelCheck | null>(cached()?.check ?? null);
  const [speech, setSpeech] = useState<SpeechCheck | null>(null);
  const box = useRef<HTMLDivElement>(null);

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
    remember(result);
    // The microphone needs a different program, so it is checked on its own.
    setSpeech(await testSpeech(settings));
    setChecking(false);
  }

  // Off, ready, or something to look at.
  const state = !settings.enabled ? "off" : check ? (check.ok ? "on" : "bad") : "unknown";
  const label = state === "off" ? "AI off" : state === "on" ? "AI ready" : state === "bad" ? "AI not answering" : "AI on";

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button className={`btn ai-pill ${state}`} onClick={() => setOpen(o => !o)}
        aria-expanded={open} title="Is the model on this computer working?">
        <span className="ai-dot" aria-hidden="true" /> {label}
      </button>
      {open && (
        <div className="ai-panel" role="dialog" aria-label="AI connection">
          <h3>AI on this computer</h3>
          {state === "off" && (
            <>
              <p className="muted">It is off. Turn it on in the settings, and point it at a model running on this computer.</p>
              <a className="btn primary" href={settingsHref}>Turn it on</a>
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
                <a className="btn ghost" href={settingsHref}>Settings</a>
              </div>
              {!check && <p className="muted" style={{ fontSize: 12 }}>Nothing has been checked yet.</p>}
            </>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Everything stays on this computer. pm-hub never sends anything to a hosted service.
          </p>
        </div>
      )}
    </div>
  );
}
