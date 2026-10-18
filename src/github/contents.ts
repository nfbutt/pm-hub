// Reading and writing small JSON files in a repository (shared plan history).
// The only place pm-hub writes files; test/write-guard.test.ts enforces that.
import { GitHubError, type GitHubClient } from "./client";

const enc = (path: string) => path.split("/").map(encodeURIComponent).join("/");

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

export interface DirEntry { name: string; path: string; sha: string; type: "file" | "dir" }

/** Files in a folder; an empty list when the folder doesn't exist yet. */
export async function listDir(client: GitHubClient, repo: string, dir: string): Promise<DirEntry[]> {
  try {
    const r = await client.rest<DirEntry[] | DirEntry>("GET", `/repos/${repo}/contents/${enc(dir)}`);
    return Array.isArray(r) ? r : [];
  } catch (e) {
    if (e instanceof GitHubError && e.kind === "not-found") return [];
    throw e;
  }
}

export async function readJson<T>(client: GitHubClient, repo: string, path: string): Promise<T> {
  const r = await client.rest<{ content?: string; encoding?: string }>("GET", `/repos/${repo}/contents/${enc(path)}`);
  if (!r.content) throw new GitHubError(`${path} is too large to read here.`, "graphql");
  return JSON.parse(fromBase64(r.content)) as T;
}

/** Creates a new file. History files are never edited, so concurrent writers can't collide. */
export async function createFile(client: GitHubClient, repo: string, path: string, text: string, message: string): Promise<void> {
  await client.rest("PUT", `/repos/${repo}/contents/${enc(path)}`, { message, content: toBase64(text) });
}

export const createJson = (client: GitHubClient, repo: string, path: string, data: unknown, message: string) =>
  createFile(client, repo, path, JSON.stringify(data, null, 1) + "\n", message);

export async function exists(client: GitHubClient, repo: string, path: string): Promise<boolean> {
  try { await client.rest("GET", `/repos/${repo}/contents/${enc(path)}`); return true; }
  catch (e) { if (e instanceof GitHubError && e.kind === "not-found") return false; throw e; }
}
