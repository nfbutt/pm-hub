// The token lives in sessionStorage by default (gone when the tab closes), or in
// localStorage when the user ticks "Remember on this device". Never in a URL.
const KEY = "pm-hub:token";

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export function readToken(): string | null {
  return safe(() => sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY), null);
}

export function saveToken(token: string, remember: boolean) {
  safe(() => {
    clearToken();
    (remember ? localStorage : sessionStorage).setItem(KEY, token);
  }, undefined);
}

export function clearToken() {
  safe(() => { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); }, undefined);
}

export function isRemembered(): boolean {
  return safe(() => localStorage.getItem(KEY) !== null, false);
}
