// The microphone in the shell: speak and the words go into whatever you were typing.
// It is the same server as the one in the Planner — a transcription server on this
// computer — so nothing is recorded by anyone else.
import { useEffect, useRef, useState } from "react";
import { transcribe } from "../../ai/voice";
import type { LocalSettings } from "../../ai/local";

const MAX_SECONDS = 90;

export function GlobalMic({ settings }: { settings: LocalSettings }) {
  const [state, setState] = useState<"idle" | "listening" | "working">("idle");
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const target = useRef<HTMLElement | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { recorder.current?.stop(); if (timer.current) clearTimeout(timer.current); }, []);

  async function toggle() {
    if (state === "listening") { recorder.current?.stop(); return; }
    setError(null);
    // Remember what you were typing into before the button took the focus.
    const active = document.activeElement as HTMLElement | null;
    target.current = active && /^(INPUT|TEXTAREA)$/.test(active.tagName) ? active : null;
    if (!navigator.mediaDevices?.getUserMedia) { setError("This browser cannot record audio."); return; }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("The microphone was not allowed."); return;
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
      setState("idle");
      if (text === null) { setError("No transcription came back. Is the speech server running?"); return; }
      setError(null);
      put(target.current, text.trim());
    };
    rec.start();
    setState("listening");
    timer.current = window.setTimeout(() => { if (recorder.current?.state === "recording") recorder.current.stop(); }, MAX_SECONDS * 1000);
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button className={`btn ${state === "listening" ? "primary" : ""}`} onClick={() => void toggle()}
        disabled={state === "working" || !settings.enabled}
        title={settings.enabled ? "Say it instead of typing it" : "Turn on a local model in Settings to use speech"}>
        {state === "listening" ? "◼" : state === "working" ? "…" : "🎤"}
      </button>
      {error && <span className="muted" style={{ fontSize: 12, color: "var(--bad)" }}>{error}</span>}
    </span>
  );
}

/** Puts the words into the field that had the focus, the way a keyboard would. */
function put(el: HTMLElement | null, text: string) {
  if (!el || !text) return;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
}
