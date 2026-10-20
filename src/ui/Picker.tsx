import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

export interface PickOption { value: string; label: string; hint?: string; /** Always shown at the top, whatever is typed. */ pinned?: boolean }

/** Searchable list. Type to filter, arrows to move, Enter to choose, Esc to close. */
export function PickList({ options, onPick, placeholder = "Search…", selected = [], autoFocus = true, emptyText = "No matches", value, onQuery }: {
  options: PickOption[]; onPick: (value: string) => void; placeholder?: string; selected?: string[]; autoFocus?: boolean; emptyText?: string;
  /** When given, the text is controlled from outside, so something else can type into it. */
  value?: string;
  /** Called whenever the text changes. */
  onQuery?: (q: string) => void;
}) {
  const [own, setOwn] = useState("");
  const q = value ?? own;
  const setQ = (next: string) => { if (value === undefined) setOwn(next); onQuery?.(next); };
  const [hi, setHi] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    // A pinned option is always there: it is the thing the person was trying to say.
    const pinned = options.filter(o => o.pinned);
    const rest = options.filter(o => !o.pinned).filter(o => words.every(w => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(w)));
    return [...pinned, ...rest].slice(0, 200);
  }, [q, options]);
  useEffect(() => setHi(0), [q]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" }); }, [hi]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(shown.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const o = shown[hi]; if (o) onPick(o.value); }
  };
  return (
    <div className="picklist">
      <input className="input" autoFocus={autoFocus} placeholder={placeholder} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
        aria-label={placeholder} role="combobox" aria-expanded="true" aria-controls="picklist-options" />
      <ul id="picklist-options" ref={listRef} role="listbox">
        {shown.map((o, i) => (
          <li key={o.value} data-i={i} role="option" aria-selected={i === hi} className={`${i === hi ? "hi" : ""} ${selected.includes(o.value) ? "on" : ""}`}
            onMouseEnter={() => setHi(i)} onMouseDown={e => { e.preventDefault(); onPick(o.value); }}>
            <span className="pl-label">{selected.includes(o.value) && <span className="tick">✓</span>}{o.label}</span>
            {o.hint && <span className="pl-hint">{o.hint}</span>}
          </li>
        ))}
        {!shown.length && <li className="empty">{emptyText}</li>}
      </ul>
    </div>
  );
}

/** A button that opens a PickList in a small popover. */
export function PickButton({ label, value, options, onPick, multi = false, selected, disabled, id }: {
  label: string; value: string; options: PickOption[]; onPick: (value: string) => void; multi?: boolean; selected?: string[]; disabled?: boolean; id: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey, true); };
  }, [open]);
  return (
    <div className="pickbtn" ref={ref}>
      <span className="pb-label" id={`${id}-label`}>{label}</span>
      <button id={id} type="button" className="pb-value" disabled={disabled} aria-labelledby={`${id}-label ${id}`} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen(!open)}>{value || <span className="muted">None</span>}<span className="caret">▾</span></button>
      {open && (
        <div className="popover">
          <PickList options={options} selected={selected} placeholder={`Find ${label.toLowerCase()}…`} onPick={v => { onPick(v); if (!multi) setOpen(false); }} />
        </div>
      )}
    </div>
  );
}
