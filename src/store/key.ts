// The key for a model that runs somewhere else. It is kept out of the preferences, and
// out of the plan history: a key is a secret and the history is shared with a team.
const SESSION = "pm-hub:model-key";
const REMEMBERED = "pm-hub:model-key-remembered";

function safe(fn: () => string | null): string | null {
  try { return fn(); } catch { return null; }
}

/** The key, if there is one. */
export function readApiKey(): string | null {
  return safe(() => sessionStorage.getItem(SESSION) || localStorage.getItem(REMEMBERED) || null);
}

/** Keeps the key. Remembering it puts it in this browser's storage; not remembering keeps
 * it only for this tab. */
export function writeApiKey(key: string, remember: boolean): void {
  try {
    sessionStorage.setItem(SESSION, key);
    localStorage.removeItem(REMEMBERED);
    if (remember) localStorage.setItem(REMEMBERED, key);
  } catch { /* private mode: the key lives for this tab only */ }
}

/** Forgets the key. */
export function clearApiKey(): void {
  try { sessionStorage.removeItem(SESSION); localStorage.removeItem(REMEMBERED); } catch { /* nothing to do */ }
}

/** Whether the key is kept between visits. */
export function keyIsRemembered(): boolean {
  return safe(() => localStorage.getItem(REMEMBERED) ? "yes" : "no") === "yes";
}
