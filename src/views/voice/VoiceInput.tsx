// The microphone button. It records what you say, sends it to the transcription server on
// this computer, and puts the words where they belong.
import { useEffect, useRef, useState } from "react";
import { testSpeech, transcribe } from "../../ai/voice";
import type { LocalSettings } from "../../ai/local";

/** Longest a recording can run, so a forgotten microphone cannot record for ever. */
const MAX_SECONDS = 90;

export function VoiceInput({ value, onChange, settings, placeholder, id, autoFocus }: {
  value: string;
  onChange: (text: string) => void;
  settings: LocalSettings;
  placeholder?: string;
  id?: string;
  autoFocus?: boolean;
}) {
  const [state, setState] = useState<"idle" | "listening" | "working" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  /** What was heard, so the words are never lost. */
  const [heard, setHeard] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { recorder.current?.stop(); if (timer.current) clearTimeout(timer.current); }, []);

  async function toggle() {
    if (state === "listening") { recorder.current?.stop(); return; }
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) { setError("This browser cannot record audio."); setState("error"); return; }
    // Check the speech server before recording, so nobody talks for a minute into a
    // server that is not there.
    const check = await testSpeech(settings);
    if (!check.ok) { setError(`${check.message} ${check.fix ?? ""}`.trim()); setState("error"); return; }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("The microphone was not allowed."); setState("error"); return;
    }
    chunks.current = [];
    const rec = new MediaRecorder(stream);
    recorder.current = rec;
    rec.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      if (timer.current) clearTimeout(timer.current);
      setState("working");
      const text = await transcribe(settings, new Blob(chunks.current, { type: rec.mimeType }));
      if (text === null) {
        const check = await testSpeech(settings);
        setError(`No words came back. ${check.fix ?? "Is the speech server running on this computer?"}`);
        setState("error");
        return;
      }
      setState("idle");
      setHeard(text.trim());
      onChange(value ? `${value.trim()} ${text.trim()}` : text.trim());
    };
    rec.start();
    setState("listening");
    timer.current = window.setTimeout(() => { if (recorder.current?.state === "recording") recorder.current.stop(); }, MAX_SECONDS * 1000);
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <textarea id={id} className="input" autoFocus={autoFocus} rows={4} value={value} placeholder={placeholder}
          style={{ fontFamily: "var(--f-body)", resize: "vertical" }}
          onChange={e => onChange(e.target.value)} />
        <button type="button" className={`btn ${state === "listening" ? "primary" : ""}`}
          onClick={() => void toggle()}
          disabled={state === "working" || !settings.enabled}
          title={settings.enabled ? "Say it instead of typing it" : "Turn on a local model in Settings to use speech"}>
          {state === "listening" ? "◼" : state === "working" ? "…" : "🎤"}
        </button>
      </div>
      {state === "listening" && <span className="muted" style={{ fontSize: 12 }}>Listening… click the square to stop.</span>}
      {state === "working" && <span className="muted" style={{ fontSize: 12 }}>Turning the recording into words…</span>}
      {heard && <span className="muted" style={{ fontSize: 12 }}>Heard: “{heard}”</span>}
      {error && <span className="muted" style={{ fontSize: 12, color: "var(--bad)" }}>{error}</span>}
    </div>
  );
}
