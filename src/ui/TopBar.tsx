import { useLayoutEffect, useRef, type ReactNode } from "react";

export function TopBar({ crumb, tabs, right }: { crumb?: ReactNode; tabs?: ReactNode; right?: ReactNode }) {
  // The bar wraps on a narrow window, and the side navigation sticks just below it.
  const bar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const set = () => document.documentElement.style.setProperty("--topbar-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <header className="topbar" ref={bar}>
      <div className="topbar-in">
        <a className="brand" href="#/">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          pm-hub
        </a>
        {crumb && <div className="crumb">{crumb}</div>}
        <div className="spacer" />
        {right && <div className="topbar-right">{right}</div>}
      </div>
      {tabs && <div className="topbar-in" style={{ paddingTop: 0 }}>{tabs}</div>}
    </header>
  );
}
