import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The token is only ever sent to api.github.com; the built page may not talk to anything
// else. Added at build time only, because Vite's dev server injects inline scripts.
export const CSP = [
  "default-src 'self'",
  "connect-src 'self' https://api.github.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://avatars.githubusercontent.com",
  "script-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

const csp = (): Plugin => ({
  name: "pm-hub-csp",
  apply: "build",
  transformIndexHtml: html =>
    html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// Served from https://nfbutt.github.io/pm-hub/ on GitHub Pages.
export default defineConfig({
  base: "/pm-hub/",
  plugins: [react(), csp()],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
