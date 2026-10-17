import type { Viewer } from "../github/load";

export function UserMenu({ viewer, onSignOut }: { viewer?: Viewer | null; onSignOut?: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {viewer && (
        <>
          <img className="avatar" src={viewer.avatarUrl} alt="" />
          <span className="muted" style={{ fontSize: 13 }}>{viewer.login}</span>
        </>
      )}
      {onSignOut && <button className="btn ghost" onClick={onSignOut}>Sign out</button>}
    </div>
  );
}
