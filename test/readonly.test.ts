import { describe, expect, it } from "vitest";
import { ALL_DOCUMENTS } from "../src/github/queries";

// pm-hub v1 promises never to change a project. Any mutation here breaks that promise.
describe("read-only guarantee", () => {
  it("sends no GraphQL mutations", () => {
    for (const doc of ALL_DOCUMENTS) expect(doc).not.toMatch(/\bmutation\b/i);
  });
});
