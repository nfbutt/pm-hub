// Light and dark. The app follows the system by default, and remembers a choice.
// The choice is applied to the document element, so every part of the app — including
// the charts, which read the colours out of the page — changes with it.
import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const KEY = "pm-hub:theme";

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch { return "system"; }
}

export function writeTheme(theme: Theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* optional */ }
}

/** The colour of the browser's own chrome, so the tab matches the app. */
function chromeColor(dark: boolean) {
  return dark ? "#0a0e15" : "#f7f8fa";
}

/** Puts the theme on the page. "system" means: whatever the system says. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", chromeColor(dark));
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => readTheme());

  useEffect(() => {
    applyTheme(theme);
    writeTheme(theme);
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return (
    <div className="seg theme-toggle" role="group" aria-label="Light or dark">
      <button className={theme === "light" ? "on" : ""} aria-pressed={theme === "light"} title="Light"
        onClick={() => setTheme("light")}>☀<span className="sr">Light</span></button>
      <button className={theme === "system" ? "on" : ""} aria-pressed={theme === "system"} title="Match the system"
        onClick={() => setTheme("system")}>◐<span className="sr">Match the system</span></button>
      <button className={theme === "dark" ? "on" : ""} aria-pressed={theme === "dark"} title="Dark"
        onClick={() => setTheme("dark")}>☾<span className="sr">Dark</span></button>
    </div>
  );
}
