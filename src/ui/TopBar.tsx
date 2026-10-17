import type { ReactNode } from "react";

export function TopBar({ crumb, tabs, right }: { crumb?: ReactNode; tabs?: ReactNode; right?: ReactNode }) {
  return (
    <header className="topbar">
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
