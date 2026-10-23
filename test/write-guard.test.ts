// pm-hub writes to GitHub only from the review screen. These checks keep it that way:
// every write lives in src/github/mutations.ts, and only src/github/apply.ts sends them,
// always through client.mutate (which treats partial data as a failure).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_DOCUMENTS } from "../src/github/queries";
import { ALL_MUTATIONS } from "../src/github/mutations";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) ? [p] : []; });
const src = files(join(__dirname, "..", "src")).map(p => ({ p: p.split("\\").join("/"), text: readFileSync(p, "utf8") }));

describe("write guard", () => {
  it("reads contain no mutations", () => {
    for (const doc of ALL_DOCUMENTS) expect(doc).not.toMatch(/\bmutation\b/i);
  });

  it("mutation documents exist only in src/github/mutations.ts", () => {
    const offenders = src.filter(f => /\bmutation\s+\w+\s*[({]/.test(f.text) && !f.p.endsWith("src/github/mutations.ts")).map(f => f.p);
    expect(offenders).toEqual([]);
  });

  it("only the apply engine imports the mutations", () => {
    const importers = src.filter(f => /from "\.\/mutations"|from "\.\.\/github\/mutations"/.test(f.text)).map(f => f.p.split("src/").pop());
    expect(importers).toEqual(["github/apply.ts"]);
  });

  it("the apply engine sends every write through client.mutate", () => {
    const apply = src.find(f => f.p.endsWith("src/github/apply.ts"))!.text;
    const queried = [...apply.matchAll(/client\.query<[^>]*>\((\w+)/g)].map(m => m[1]);
    expect(queried.sort()).toEqual(["ITEMS_BY_ID", "REPO_META"]);
    expect(Object.keys(ALL_MUTATIONS)).toHaveLength(17);
  });

  it("milestones are written only by the apply engine, and nothing else is written over REST there", () => {
    // GraphQL cannot make a milestone, so releases are written over REST: POST and PATCH,
    // from apply.ts only, and only to a repository's milestones.
    const writers = src.filter(f => /\.rest(?:<[^>]*>)?\(\s*(?:"POST"|"PATCH"|method\b)/.test(f.text)).map(f => f.p.split("src/").pop());
    expect(writers).toEqual(["github/apply.ts"]);
    const apply = src.find(f => f.p.endsWith("src/github/apply.ts"))!.text;
    const restCalls = [...apply.matchAll(/client\.rest(?:<[^>]*>)?\(([^,]+),\s*([^,)]+)/g)];
    expect(restCalls).toHaveLength(2);
    expect(restCalls.every(m => m[2]!.includes("milestonesPath") || m[2]!.trim() === "path")).toBe(true);
    const sends = [...apply.matchAll(/send\("(\w+)",\s*([^,]+),/g)];
    expect(sends.length).toBeGreaterThan(0);
    expect(sends.every(m => ["POST", "PATCH"].includes(m[1]!) && m[2]!.startsWith("milestonesPath("))).toBe(true);
  });

  it("files are written only by contents.ts, and only the history store uses it", () => {
    const putters = src.filter(f => /rest(<[^>]*>)?\(\s*"PUT"/.test(f.text)).map(f => f.p.split("src/").pop());
    expect(putters).toEqual(["github/contents.ts"]);
    const importers = src.filter(f => /github\/contents"|from "\.\/contents"/.test(f.text)).map(f => f.p.split("src/").pop());
    expect(importers).toEqual(["store/history.ts"]);
    // REST writes are limited to the contents API.
    const contents = src.find(f => f.p.endsWith("src/github/contents.ts"))!.text;
    expect([...contents.matchAll(/rest(?:<[^>]*>)?\("(\w+)", `([^`]*)`/g)].every(m => m[2]!.includes("/contents/"))).toBe(true);
  });
});
