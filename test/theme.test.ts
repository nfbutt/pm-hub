// The theme is put on the page by a script that runs before the first paint, and the
// content policy allows exactly that one script by its hash. If the two ever drift
// apart, the browser blocks the script and a dark app flashes light — so they are
// checked here, rather than found by looking.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config, { CSP } from "../vite.config";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

/** The built page, as the plugin makes it. */
function build(): string {
  const plugins = (config.plugins ?? []) as { name?: string }[];
  const plugin = plugins.find(p => p && typeof p === "object" && p.name === "pm-hub-csp");
  if (!plugin) throw new Error("the policy plugin is missing");
  const hook = (plugin as { transformIndexHtml: (html: string, ctx?: unknown) => unknown }).transformIndexHtml;
  const out = hook.call({} as never, html, {});
  return typeof out === "string" ? out : String((out as { html: string }).html);
}

describe("the theme, before the first paint", () => {
  it("puts the theme on the page while the document is still being read", () => {
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain('id="pm-hub-theme"');
    // The app's own script is in the body, so the theme is always the first thing to run.
    expect(html.indexOf('id="pm-hub-theme"')).toBeLessThan(html.indexOf("/src/main.tsx"));
  });

  it("reads the theme the person chose", () => {
    expect(html).toContain('localStorage.getItem("pm-hub:theme")');
    expect(html).toContain("dataset.theme");
  });

  it("lets the policy allow that one script, and nothing else", () => {
    // The policy as it stands does not allow inline scripts at all.
    const scripts = CSP.split("; ").find(d => d.startsWith("script-src"))!;
    expect(scripts).toBe("script-src 'self'");
    expect(scripts).not.toContain("unsafe-inline");
  });

  it("allows the script that actually ships, by its hash", () => {
    const built = build();
    const script = built.match(/<script id="pm-hub-theme">([\s\S]*?)<\/script>/);
    const policy = built.match(/script-src 'self' 'sha256-([^']+)'/);
    expect(script).not.toBeNull();
    expect(policy).not.toBeNull();
    // The hash is of the text that ships, so the browser runs it.
    const hash = createHash("sha256").update(script![1]!).digest("base64");
    expect(policy![1]).toBe(hash);
  });
});
