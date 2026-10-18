// Minimal GitHub GraphQL client. The token goes to api.github.com only, in a header.
import type { RateLimit } from "./types";

export const GRAPHQL_URL = "https://api.github.com/graphql";

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "scope" | "rate-limit" | "not-found" | "network" | "graphql",
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

export interface ClientState { scopes: string[] | null; rateLimit: RateLimit | null }

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function createClient(token: string, fetchImpl: FetchLike = (i, o) => fetch(i, o)) {
  const state: ClientState = { scopes: null, rateLimit: null };

  /** Reads accept partial data (e.g. one org hidden); writes go through mutate(), which doesn't. */
  async function query<T>(document: string, variables: Record<string, unknown> = {}, attempt = 0, strict = false): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(GRAPHQL_URL, {
        method: "POST",
        headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: document, variables }),
      });
    } catch (e) {
      throw new GitHubError("Couldn't reach GitHub. Check your connection and try again.", "network", e);
    }

    const scopeHeader = res.headers.get("x-oauth-scopes");
    if (scopeHeader !== null) state.scopes = scopeHeader.split(",").map(s => s.trim()).filter(Boolean);

    if (res.status === 401) throw new GitHubError("GitHub rejected this token. It may be expired or revoked.", "auth");
    if (res.status === 403 || res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? 0);
      if (retryAfter > 0 && retryAfter <= 60 && attempt < 2) {
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        return query<T>(document, variables, attempt + 1, strict);
      }
      throw new GitHubError("GitHub's rate limit was reached. Wait a few minutes, then refresh.", "rate-limit");
    }
    if (!res.ok) throw new GitHubError(`GitHub returned ${res.status}.`, "network");

    const body = (await res.json()) as { data?: T & { rateLimit?: RateLimit }; errors?: { type?: string; message: string }[] };
    if (body.data?.rateLimit) state.rateLimit = body.data.rateLimit;
    if (body.errors?.length) {
      const first = body.errors[0]!;
      if (first.type === "INSUFFICIENT_SCOPES") {
        throw new GitHubError(`This token is missing a scope GitHub needs: ${first.message}`, "scope", body.errors);
      }
      if (first.type === "NOT_FOUND") throw new GitHubError("That project wasn't found, or this token can't see it.", "not-found", body.errors);
      // Partial data with errors (e.g. one inaccessible org) is still usable for reads,
      // never for writes: a rejected mutation can come back as partial data.
      if (!body.data || strict) throw new GitHubError(first.message, "graphql", body.errors);
    }
    if (!body.data) throw new GitHubError("GitHub returned an empty response.", "graphql");
    return body.data;
  }

  /** For mutations: any GraphQL error fails the call. */
  const mutate = <T>(document: string, variables: Record<string, unknown> = {}) => query<T>(document, variables, 0, true);

  /** REST calls to api.github.com (used for history files). Writes (PUT) only from contents.ts. */
  async function rest<T>(method: "GET" | "PUT", path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`https://api.github.com${path}`, {
        method,
        // GitHub sends max-age=60; revalidate so history written a moment ago shows up (a 304 is free).
        cache: "no-cache",
        headers: { Authorization: `bearer ${token}`, Accept: "application/vnd.github+json", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new GitHubError("Couldn't reach GitHub. Check your connection and try again.", "network", e);
    }
    if (res.status === 401) throw new GitHubError("GitHub rejected this token. It may be expired or revoked.", "auth");
    if (res.status === 404) throw new GitHubError("Not found, or this token can't see it.", "not-found");
    const json = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (res.status === 403 || res.status === 429) throw new GitHubError(json.message ?? "GitHub refused the request.", /rate limit/i.test(json.message ?? "") ? "rate-limit" : "scope");
    if (!res.ok) throw new GitHubError(json.message ?? `GitHub returned ${res.status}.`, "network");
    return json;
  }

  return { query, mutate, rest, state };
}

export type GitHubClient = ReturnType<typeof createClient>;

export const REQUIRED_SCOPES = ["read:project", "repo"] as const;

/**
 * Whether a token can apply changes. Classic tokens report scopes; fine-grained tokens
 * don't, so the answer is "unknown" and GitHub's response is the judge.
 */
export function writeAccess(scopes: string[] | null): "yes" | "no" | "unknown" {
  if (scopes === null) return "unknown";
  return scopes.includes("project") && (scopes.includes("repo") || scopes.includes("public_repo")) ? "yes" : "no";
}

/** Classic tokens report scopes; fine-grained tokens don't send the header (scopes = null). */
export function missingScopes(scopes: string[] | null): string[] {
  if (scopes === null) return [];
  const has = (s: string) =>
    scopes.includes(s) ||
    (s === "read:project" && scopes.includes("project")) ||
    (s === "repo" && scopes.includes("public_repo"));
  return REQUIRED_SCOPES.filter(s => !has(s));
}
