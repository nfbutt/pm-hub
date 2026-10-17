import { useRef, useState } from "react";

/** A read-only text box with a Copy button. Downloads are avoided on purpose: copying works everywhere. */
export function CopyBox({ id, label, text }: { id: string; label: string; text: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState<string | null>(null);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setNote("Copied"); }
    catch { ref.current?.focus(); ref.current?.select(); setNote("Selected. Press Ctrl+C to copy."); }
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div className="section-h" style={{ marginBottom: 0 }}>
        <label htmlFor={id} style={{ fontWeight: 700 }}>{label}</label>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {note && <span className="pill good">{note}</span>}
          <button className="btn" onClick={copy}>Copy {label}</button>
        </span>
      </div>
      <textarea id={id} ref={ref} className="input" readOnly value={text} rows={8} style={{ resize: "vertical", fontSize: 12 }} />
    </div>
  );
}
