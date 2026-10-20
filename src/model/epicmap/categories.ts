// What kind of work an item is: backend, frontend, security… Inferred from its words and
// labels against a keyword dictionary, so any project gets categories without setup. Pure.
import { splitPrefixed } from "../mapping";
import { stem, tokenize } from "./text";

export interface Category { id: string; name: string; keywords: string[] }

export const CATEGORIES: Category[] = [
  { id: "frontend", name: "Frontend", keywords: ["ui", "ux", "page", "screen", "view", "component", "css", "react", "button", "form", "layout", "modal", "banner", "frontend", "tour", "wizard", "dashboard", "feed"] },
  { id: "backend", name: "Backend", keywords: ["api", "endpoint", "service", "database", "schema", "queue", "job", "worker", "server", "backend", "graphql", "rest", "cache", "webhook", "pagination", "openapi", "model", "pipeline", "aggregation", "sync"] },
  { id: "security", name: "Security", keywords: ["security", "auth", "authentication", "login", "password", "token", "permission", "role", "sso", "saml", "oidc", "oauth", "encrypt", "encryption", "secret", "vulnerability", "csrf", "xss", "mfa", "2fa", "session", "access", "revocation", "compliance"] },
  { id: "data", name: "Data & analytics", keywords: ["metric", "metrics", "analytics", "report", "export", "import", "etl", "warehouse", "instrument", "event", "events", "tracking", "csv", "retention", "log", "audit"] },
  { id: "infra", name: "Infrastructure", keywords: ["deploy", "ci", "docker", "kubernetes", "terraform", "monitoring", "alert", "uptime", "scaling", "infra", "infrastructure", "flaky", "build", "latency", "performance", "rate", "limiting"] },
  { id: "business", name: "Business", keywords: ["pricing", "price", "billing", "invoice", "payment", "checkout", "stripe", "subscription", "revenue", "customer", "onboarding", "trial", "plan", "tax", "overage", "tier", "enterprise", "signup", "usage", "metering"] },
  { id: "mobile", name: "Mobile", keywords: ["mobile", "ios", "android", "push", "notification", "apns", "fcm", "offline", "device", "badge", "deep", "app"] },
  { id: "quality", name: "Quality", keywords: ["test", "tests", "qa", "bug", "regression", "e2e", "coverage", "harden", "fix", "crash"] },
  { id: "docs", name: "Docs & design", keywords: ["document", "docs", "documentation", "guide", "readme", "tutorial", "changelog", "design", "mockup", "prototype", "figma", "wireframe", "research", "email", "template"] },
];
export const UNCATEGORIZED = "other";

const KEYWORD_INDEX = (() => {
  const m = new Map<string, string[]>();
  for (const c of CATEGORIES) for (const k of c.keywords) { const s = stem(k); m.set(s, [...(m.get(s) ?? []), c.id]); }
  return m;
})();

/** Category id -> share of the item's signal (sums to 1), or empty when nothing matched. */
export type Mix = Map<string, number>;

/** Infers a mix from words and labels. A label naming a category ("area: security", "frontend") counts double. */
export function categorize(title: string, body: string | undefined, labels: string[]): Mix {
  const score = new Map<string, number>();
  const hit = (token: string, w: number) => { for (const id of KEYWORD_INDEX.get(token) ?? []) score.set(id, (score.get(id) ?? 0) + w); };
  for (const t of tokenize(title)) hit(t, 2);
  for (const t of tokenize(body ?? "")) hit(t, 1);
  for (const l of labels) {
    const value = splitPrefixed(l)?.[1] ?? l;
    for (const t of tokenize(value)) hit(t, 2);
  }
  return share(score);
}

function share(score: Map<string, number>): Mix {
  let total = 0;
  for (const v of score.values()) total += v;
  const out: Mix = new Map();
  if (total === 0) return out;
  for (const [k, v] of score) out.set(k, v / total);
  return out;
}

/** Adds mixes together (e.g. an epic's tasks) and renormalises. */
export function mergeMixes(mixes: Mix[]): Mix {
  const sum = new Map<string, number>();
  for (const m of mixes) for (const [k, v] of m) sum.set(k, (sum.get(k) ?? 0) + v);
  return share(sum);
}

export function dominant(m: Mix): { id: string; share: number } {
  let best = { id: UNCATEGORIZED, share: 0 };
  for (const [id, s] of m) if (s > best.share) best = { id, share: s };
  return best;
}

export const categoryName = (id: string) => CATEGORIES.find(c => c.id === id)?.name ?? "Other";
