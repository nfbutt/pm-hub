import type { Viewer } from "../github/load";

export function UserMenu({ viewer, onSignOut, onChangeToken }: { viewer?: Viewer | null; onSignOut?: () => void; onChangeToken?: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {viewer && (
        <>
          <img className="avatar" src={viewer.avatarUrl} alt="" />
          <span className="muted" style={{ fontSize: 13 }}>{viewer.login}</span>
        </>
      )}
      {onChangeToken && <button className="btn ghost" onClick={onChangeToken}>Change token</button>}
      {onSignOut && <button className="btn ghost" onClick={onSignOut}>Sign out</button>}
    </div>
  );
}
