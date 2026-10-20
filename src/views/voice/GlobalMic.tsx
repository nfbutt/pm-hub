// The microphone in the shell: speak and the words go into whatever you were typing.
// It is the same server as the one in the Planner — a transcription server on this
// computer — so nothing is recorded by anyone else.
import { useState } from "react";
import type { LocalSettings } from "../../ai/local";
import { useDictation } from "./useDictation";

export function GlobalMic({ settings }: { settings: LocalSettings }) {
  const [heard, setHeard] = useState<string | null>(null);
  // Remember what you were typing into before the button took the focus.
  let target: HTMLElement | null = null;
  const dictation = useDictation(settings, text => {
    setHeard(text);
    if (put(target, text)) return;
    // There was no field to type into, so the words are kept here and copied.
    void navigator.clipboard?.writeText(text);
  });

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button className={`btn ${dictation.listening ? "primary" : ""}`} onClick={() => {
        const active = document.activeElement as HTMLElement | null;
        target = active && /^(INPUT|TEXTAREA)$/.test(active.tagName) ? active : null;
        dictation.toggle();
      }}
        disabled={dictation.working || !settings.enabled}
        title={settings.enabled ? "Say it instead of typing it" : "Turn on a local model in Settings to use speech"}>
        {dictation.listening ? "◼" : dictation.working ? "…" : "🎤"}
      </button>
      {dictation.error && <span className="muted" style={{ fontSize: 12, color: "var(--bad)" }}>{dictation.error}</span>}
      {heard && !dictation.error && <span className="muted" style={{ fontSize: 12 }} title="Copied to the clipboard">Heard: {heard}</span>}
    </span>
  );
}

/** Puts the words into the field that had the focus, the way a keyboard would. */
function put(el: HTMLElement | null, text: string): boolean {
  if (!el || !text) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
  return true;
}
