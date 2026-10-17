import { useEffect, type ReactNode } from "react";

export function Drawer({ title, eyebrow, onClose, children, meta }: {
  title: string; eyebrow?: ReactNode; meta?: ReactNode; onClose: () => void; children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div className="dhead">
          <button className="x" onClick={onClose} aria-label="Close">×</button>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2 id="drawer-title">{title}</h2>
          {meta && <div className="dmeta">{meta}</div>}
        </div>
        <div className="dbody">{children}</div>
      </aside>
    </>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mbox" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="section-h"><h2 id="modal-title">{title}</h2><button className="btn" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}
