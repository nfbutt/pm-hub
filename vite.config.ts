import { createHash } from "node:crypto";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The token is only ever sent to api.github.com; the built page may not talk to anything
// else, except a model on the user's own machine, or a hosted model the user has
// explicitly allowed.
// Added at build time only, because Vite's dev server injects inline scripts.
export const CSP = [
  "default-src 'self'",
  "connect-src 'self' https://api.github.com http://localhost:* http://127.0.0.1:* https://openrouter.ai",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://avatars.githubusercontent.com",
  "script-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

/**
 * The theme has to be on the page before the first paint, which means a script that runs
 * while the document is still being read. The policy allows exactly that one script, by
 * its hash, so nothing else can be inlined — the rest of the policy stays strict.
 */
const csp = (): Plugin => ({
  name: "pm-hub-csp",
  apply: "build",
  // After Vite's own html transforms, so the hash is of the text that ships.
  enforce: "post",
  transformIndexHtml: html => {
    const script = html.match(/<script id="pm-hub-theme">([\s\S]*?)<\/script>/);
    if (!script) return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    const hash = createHash("sha256").update(script[1]!).digest("base64");
    const policy = CSP.replace("script-src 'self'", `script-src 'self' 'sha256-${hash}'`);
    return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
  },
});

// Served from https://nfbutt.github.io/pm-hub/ on GitHub Pages.
export default defineConfig({
  base: "/pm-hub/",
  plugins: [react(), csp()],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
