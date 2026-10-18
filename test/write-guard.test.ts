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
});
