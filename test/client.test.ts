import { describe, expect, it } from "vitest";
import { createClient, GitHubError, GRAPHQL_URL, missingScopes, type FetchLike } from "../src/github/client";

const respond = (status: number, body: unknown, headers: Record<string, string> = {}): FetchLike =>
  async () => new Response(JSON.stringify(body), { status, headers });

describe("createClient", () => {
  it("sends the token only to api.github.com, in a header", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const client = createClient("ghp_secret", async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ data: { ok: 1 } })); });
    await client.query("query { viewer { login } }");
    expect(seen!.url).toBe(GRAPHQL_URL);
    expect(seen!.url).not.toContain("ghp_secret");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("bearer ghp_secret");
  });

  it("records scopes and rate limit", async () => {
    const client = createClient("t", respond(200, { data: { rateLimit: { remaining: 4900, limit: 5000, resetAt: "x", cost: 1 } } }, { "x-oauth-scopes": "repo, read:project" }));
    await client.query("q");
    expect(client.state.scopes).toEqual(["repo", "read:project"]);
    expect(client.state.rateLimit?.remaining).toBe(4900);
  });

  it.each([
    [401, {}, "auth"],
    [403, {}, "rate-limit"],
    [200, { errors: [{ type: "INSUFFICIENT_SCOPES", message: "needs read:project" }] }, "scope"],
    [200, { errors: [{ type: "NOT_FOUND", message: "nope" }] }, "not-found"],
  ])("maps HTTP %i to a %s error", async (status, body, kind) => {
    const client = createClient("t", respond(status, body));
    await expect(client.query("q")).rejects.toMatchObject({ kind });
  });

  it("keeps partial data when GitHub returns data alongside errors", async () => {
    const client = createClient("t", respond(200, { data: { a: 1 }, errors: [{ type: "FORBIDDEN", message: "one org hidden" }] }));
    await expect(client.query<{ a: number }>("q")).resolves.toEqual({ a: 1 });
  });

  it("reports network failures plainly", async () => {
    const client = createClient("t", async () => { throw new TypeError("Failed to fetch"); });
    const err = (await client.query("q").catch(e => e)) as GitHubError;
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.kind).toBe("network");
  });
});

describe("missingScopes", () => {
  it("accepts project/public_repo as stronger or equivalent scopes", () => {
    expect(missingScopes(["project", "public_repo"])).toEqual([]);
    expect(missingScopes(["repo"])).toEqual(["read:project"]);
    expect(missingScopes(null)).toEqual([]);
  });
});
