import { useEffect, useId, useRef, type ReactNode } from "react";
import type React from "react";

/**
 * Overlays handle the keyboard properly: focus moves in when they open, stays inside
 * while they are open, and goes back where it came from when they close. Only the topmost
 * one answers Escape — a modal on top of a drawer used to close both.
 */

/** The overlays that are open, newest last. The last one is the topmost. */
const stack: { close: () => void }[] = [];

/** Puts focus inside an overlay, keeps it there, and gives it back on close. */
function useOverlay(onClose: () => void) {
  const ref = useRef<HTMLDivElement & HTMLElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const entry = { close: onClose };
    stack.push(entry);
    // Focus the first thing worth focusing, or the overlay itself.
    const t = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const target = el.querySelector<HTMLElement>("input, select, textarea, button, [tabindex]:not([tabindex='-1'])") ?? el;
      target.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const el = ref.current;
      if (!el) return;
      const focusable = [...el.querySelectorAll<HTMLElement>("input, select, textarea, button, [href], [tabindex]:not([tabindex='-1'])")]
        .filter(x => !x.hasAttribute("disabled") && x.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) return;
      const first = focusable[0]!, last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(t);
      removeEventListener("keydown", onKey, true);
      const at = stack.indexOf(entry);
      if (at >= 0) stack.splice(at, 1);
      before?.focus?.();
    };
  }, [onClose]);
  return ref;
}

export function Drawer({ title, eyebrow, onClose, children, meta }: {
  title: string; eyebrow?: ReactNode; meta?: ReactNode; onClose: () => void; children: ReactNode;
}) {
  const ref = useOverlay(onClose);
  const id = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Only the topmost overlay answers.
      if (stack[stack.length - 1]?.close !== onClose) return;
      e.preventDefault();
      onClose();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref as React.Ref<HTMLElement>} tabIndex={-1}>
        <div className="dhead">
          <button className="x" onClick={onClose} aria-label="Close">×</button>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2 id={id}>{title}</h2>
          {meta && <div className="dmeta">{meta}</div>}
        </div>
        <div className="dbody">{children}</div>
      </aside>
    </>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useOverlay(onClose);
  const id = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (stack[stack.length - 1]?.close !== onClose) return;
      e.preventDefault();
      onClose();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mbox" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref as React.Ref<HTMLDivElement>} tabIndex={-1}>
        <div className="section-h"><h2 id={id}>{title}</h2><button className="btn" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}
