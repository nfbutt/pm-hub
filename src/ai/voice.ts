// Speaking to the app. The transcription runs on a server on this computer — the browser's
// own speech API sends the audio to a search engine, which would break the promise pm-hub
// makes — and the reply is read back with a voice the browser keeps on the machine.
import { DEFAULT_VOICE_BASE, DEFAULT_VOICE_MODEL, isLocalBase } from "./local";
import type { LocalSettings } from "./local";

const trimSlash = (s: string) => s.replace(/\/+$/, "");

/**
 * Transcribes a recording. The server is the OpenAI-compatible one Speaches and
 * friends speak: `POST {base}/audio/transcriptions`. Anything that goes wrong comes
 * back as null, so the caller can carry on without speech.
 */
export async function transcribe(settings: LocalSettings, audio: Blob): Promise<string | null> {
  const base = settings.voiceBase || DEFAULT_VOICE_BASE;
  const model = settings.voiceModel || DEFAULT_VOICE_MODEL;
  if (!settings.enabled || !isLocalBase(base)) return null;
  const form = new FormData();
  form.append("file", audio, "speech.webm");
  form.append("model", model);
  try {
    const res = await fetch(`${trimSlash(base)}/audio/transcriptions`, { method: "POST", body: form });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data as { text?: unknown }).text;
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

/** The voices the browser keeps on this machine. */
export function localVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === "undefined") return [];
  return speechSynthesis.getVoices().filter(v => v.localService);
}

/** Reads a line out loud, using a voice that does not go to the internet. */
export function speak(text: string, lang = "en-GB") {
  if (typeof speechSynthesis === "undefined" || !text.trim()) return;
  const voices = localVoices();
  const u = new SpeechSynthesisUtterance(text);
  if (voices.length) u.voice = voices.find(v => v.lang.toLowerCase().startsWith(lang.slice(0, 2))) ?? voices[0]!;
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

/** Reads a line out loud. The name the views use. */
export const say = speak;

/** Stops reading out loud. */
export function stopSpeaking() {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

/** What the speech server can do, and how to start it. */
export interface SpeechCheck {
  ok: boolean;
  message: string;
  fix: string | null;
}

/**
 * Is there a speech server on this computer? The microphone needs one, and it is a
 * different program from the chat model — Ollama does not transcribe.
 */
export async function testSpeech(settings: LocalSettings): Promise<SpeechCheck> {
  const base = settings.voiceBase || DEFAULT_VOICE_BASE;
  if (!isLocalBase(base)) return { ok: false, message: "The speech address is not on this computer.", fix: "Use localhost or 127.0.0.1." };
  try {
    const res = await fetch(`${trimSlash(base)}/models`, { method: "GET" });
    if (!res.ok) throw new Error("no");
    return { ok: true, message: "The speech server is there and the microphone can work.", fix: null };
  } catch {
    return {
      ok: false,
      message: `Nothing is answering at ${base}.`,
      fix: "Start a speech server there, for example: docker run -p 8000:8000 ghcr.io/speaches-ai/speaches:latest",
    };
  }
}
