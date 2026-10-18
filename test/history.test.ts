// Plan history: the GitHub-backed store (through a fake REST API) and its file layout.
import { describe, expect, it } from "vitest";
import { createClient } from "../src/github/client";
import { githubHistory, type ChangeRecord } from "../src/store/history";
import { snapshot } from "../src/model/diff";
import { detectMapping } from "../src/model/mapping";
import { buildSchedule } from "../src/model/schedule";
import { demoProject } from "../src/views/useProject";

/** A tiny in-memory stand-in for GitHub's contents API. */
function fakeGitHub() {
  const files = new Map<string, string>();
  const calls: { method: string; path: string }[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const path = decodeURIComponent(url.replace(/^https:\/\/api\.github\.com\/repos\/o\/r\/contents\//, ""));
    calls.push({ method: init.method ?? "GET", path });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (init.method === "PUT") {
      if (files.has(path)) return json(422, { message: "sha wasn't supplied" });
      const { content } = JSON.parse(String(init.body)) as { content: string };
      files.set(path, Buffer.from(content, "base64").toString("utf8"));
      return json(201, { content: { path } });
    }
    if (files.has(path)) return json(200, { content: Buffer.from(files.get(path)!).toString("base64"), encoding: "base64" });
    const kids = [...files.keys()].filter(p => p.startsWith(path + "/") && !p.slice(path.length + 1).includes("/"));
    if (kids.length) return json(200, kids.map(p => ({ name: p.split("/").pop(), path: p, sha: "x", type: "file" })));
    return json(404, { message: "Not Found" });
  };
  return { files, calls, client: createClient("t", fetchImpl) };
}

const project = demoProject();
const mapping = detectMapping(project);

describe("GitHub history store", () => {
  it("is empty before anything is saved", async () => {
    const gh = fakeGitHub();
    const h = githubHistory(gh.client, "o/r", ".pm-hub/o-1");
    expect(await h.listBaselines()).toEqual([]);
    expect(await h.listChanges()).toEqual([]);
  });

  it("saves baselines as new files with a README, and reads them back newest first", async () => {
    const gh = fakeGitHub();
    const h = githubHistory(gh.client, "o/r", ".pm-hub/o-1");
    const s = buildSchedule(project, mapping);
    await h.saveBaseline(snapshot(project, mapping, s, "Q1 plan", false, "2026-01-05T10:00:00.000Z"));
    await h.saveBaseline(snapshot(project, mapping, s, "Before apply", true, "2026-02-01T09:30:15.250Z"));
    expect([...gh.files.keys()].sort()).toEqual([
      ".pm-hub/o-1/README.md",
      ".pm-hub/o-1/baselines/2026-01-05T10-00-00-000Z__manual__q1-plan.json",
      ".pm-hub/o-1/baselines/2026-02-01T09-30-15-250Z__auto__before-apply.json",
    ]);
    const list = await h.listBaselines();
    expect(list.map(b => [b.name, b.savedAt, b.auto])).toEqual([
      ["Before apply", "2026-02-01T09:30:15.250Z", true],
      ["Q1 plan", "2026-01-05T10:00:00.000Z", false],
    ]);
    const back = await h.readBaseline(list[1]!.id);
    expect(back.name).toBe("Q1 plan");
    expect(back.items.length).toBe(project.items.length);
    // Never edits a file: the README is written once.
    expect(gh.calls.filter(c => c.method === "PUT" && c.path.endsWith("README.md"))).toHaveLength(1);
  });

  it("records applies as one file each", async () => {
    const gh = fakeGitHub();
    const h = githubHistory(gh.client, "o/r", "plans");
    const rec = (at: string): ChangeRecord => ({ version: 1, at, author: "me", scenario: "Default", steps: [{ label: "Moved X", status: "applied", kind: "setDates", reason: "waiting on access" }] });
    await h.saveChange(rec("2026-03-01T00:00:00.000Z"));
    await h.saveChange(rec("2026-03-02T00:00:00.000Z"));
    const list = await h.listChanges();
    expect(list.map(c => c.at)).toEqual(["2026-03-02T00:00:00.000Z", "2026-03-01T00:00:00.000Z"]);
    expect(list[0]!.steps[0]!.reason).toBe("waiting on access");
  });
});
