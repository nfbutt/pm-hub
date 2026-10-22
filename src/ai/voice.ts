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
  // The speech server is its own thing: the chat model does not transcribe, so the
  // microphone does not wait for the chat model to be turned on.
  if (!isLocalBase(base)) return null;
  const model = await voiceModelFor(base, settings.voiceModel);
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

/**
 * The speech models the server has. Speaches calls them by their full name
 * ("Systran/faster-whisper-base"), which is not the "whisper-1" that OpenAI uses, so
 * asking is better than guessing.
 */
export async function listVoiceModels(base: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${trimSlash(base)}/models`, { method: "GET" });
    if (!res.ok) return null;
    const data = await res.json();
    const rows = (data as { data?: { id?: unknown }[]; models?: { id?: unknown }[] }).data
      ?? (data as { models?: { id?: unknown }[] }).models;
    // A server that answers in a shape we do not know is not a server with no models.
    if (!Array.isArray(rows)) return null;
    return rows.map(r => r?.id).filter((id): id is string => typeof id === "string");
  } catch {
    return null;
  }
}

/**
 * The model to transcribe with: the one that was asked for, if the server has it, and
 * otherwise one the server does have. A name the server has never heard of would fail
 * every single time, and the microphone would look broken.
 */
export async function voiceModelFor(base: string, wanted?: string): Promise<string> {
  const models = await listVoiceModels(base);
  if (!models?.length) return wanted || DEFAULT_VOICE_MODEL;
  if (wanted && models.includes(wanted)) return wanted;
  return models[0]!;
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
    const models = await listVoiceModels(base);
    if (models && !models.length) {
      return {
        ok: false,
        message: "The speech server is there, but it has no speech model.",
        fix: "Give it one, for example:\ncurl -X POST http://localhost:8000/v1/models/Systran/faster-whisper-base -H 'Content-Type: application/json' -d '{\"type\": \"speech-to-text\"}'",
      };
    }
    const what = models?.length ? ` It has ${models.length === 1 ? "one model" : `${models.length} models`}: ${models.join(", ")}.` : "";
    return { ok: true, message: `The speech server is there and the microphone can work.${what}`, fix: null };
  } catch {
    return {
      ok: false,
      message: `Nothing is answering at ${base}.`,
      fix: "Start a speech server there, for example:\ndocker run -p 8000:8000 ghcr.io/speaches-ai/speaches:latest-cpu",
    };
  }
}
