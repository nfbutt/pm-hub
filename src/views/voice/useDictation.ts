// Recording, and turning the recording into words. The audio never leaves this computer:
// it goes to the transcription server in Settings, and nowhere else.
import { useEffect, useRef, useState } from "react";
import { testSpeech, transcribe } from "../../ai/voice";
import type { LocalSettings } from "../../ai/local";

/** Longest a recording can run, so a forgotten microphone cannot record for ever. */
export const MAX_SECONDS = 90;

export interface Dictation {
  /** True while it is listening. */
  listening: boolean;
  /** True while the recording is being transcribed. */
  working: boolean;
  error: string | null;
  /** Starts listening, or stops if it already is. */
  toggle: () => void;
  /** Stops listening and hands back the words. */
  stop: () => void;
}

export function useDictation(settings: LocalSettings, onText: (text: string) => void): Dictation {
  const [listening, setListening] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { recorder.current?.stop(); if (timer.current) clearTimeout(timer.current); }, []);

  async function start() {
    setError(null);
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
      setListening(false);
      setWorking(true);
      const text = await transcribe(settings, new Blob(chunks.current, { type: rec.mimeType }));
      setWorking(false);
      if (text === null) {
        // Say why: the server may not be there, or it may have no speech model.
        const check = await testSpeech(settings);
        setError(`No words came back. ${check.message} ${check.fix ?? ""}`.trim());
        return;
      }
      setError(null);
      onText(text.trim());
    };
    rec.start();
    setListening(true);
    timer.current = window.setTimeout(() => { if (recorder.current?.state === "recording") recorder.current.stop(); }, MAX_SECONDS * 1000);
  }

  function stop() {
    const rec = recorder.current;
    if (rec && rec.state === "recording") rec.stop();
    else setListening(false);
  }

  return { listening, working, error, toggle: () => (listening ? stop() : void start()), stop };
}
