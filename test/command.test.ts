// The command surface's pure part: finding the thing someone means, understanding what
// they are asking for, and turning that into the same operations a mouse would make.
import { describe, expect, it } from "vitest";
import { makeFixture, DEMO_OWNER } from "../src/demo/fixture";
import { normalizeProject } from "../src/model/normalize";
import { detectMapping } from "../src/model/mapping";
import { findTargets, parsePhrase } from "../src/model/command/targets";
import { fillSlot, parseIntent, parseShift, slotPhrase } from "../src/model/command/intent";
import { intentOps, mergeEpics } from "../src/model/command/ops";
import { buildSchedule } from "../src/model/schedule";

const f = makeFixture("2026-10-19");
const project = normalizeProject(DEMO_OWNER, f.meta, f.items, "2026-10-19T12:00:00Z");
const mapping = detectMapping(project);
const title = (t: string) => project.items.find(i => i.title === t)!;

describe("finding the thing someone means", () => {
  it("reads a type out of the phrase", () => {
    const parsed = parsePhrase("the API epic");
    expect(parsed.kind).toBe("epic");
    expect(parsed.words).toEqual(["api"]);
  });

  it("reads a number out of the phrase", () => {
    const parsed = parsePhrase("issue #140");
    expect(parsed.number).toBe("140");
  });

  it("reads a release out of the phrase", () => {
    const parsed = parsePhrase("the billing epic in the March release");
    expect(parsed.release).toBe("march");
  });

  it("finds an epic when the phrase says epic", () => {
    const found = findTargets(project, mapping, "offline mode epic");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]!.title).toBe("Offline mode");
    expect(found[0]!.kind).toBe("epic");
  });

  it("does not offer an epic when the phrase says story", () => {
    const found = findTargets(project, mapping, "offline mode story");
    expect(found.every(t => t.kind === "story")).toBe(true);
    expect(found.find(t => t.title === "Offline mode")).toBeUndefined();
  });

  it("finds an item by its number", () => {
    const item = title("Offline mode");
    const found = findTargets(project, mapping, `#${item.number}`);
    expect(found[0]!.key).toBe(item.key);
  });

  it("ranks the closest match first", () => {
    const found = findTargets(project, mapping, "audit log exports");
    expect(found[0]!.title).toBe("Audit log and exports");
  });

  it("finds nothing when the words are not there", () => {
    expect(findTargets(project, mapping, "quantum teleportation")).toHaveLength(0);
  });
});

describe("understanding what is being asked", () => {
  it("reads a shift in days and weeks", () => {
    expect(parseShift("two weeks later")).toBe(14);
    expect(parseShift("a week earlier")).toBe(-7);
    expect(parseShift("3 days later")).toBe(3);
    expect(parseShift("no time here")).toBeNull();
  });

  it("understands moving something later", () => {
    const parsed = parseIntent("move the Offline mode epic two weeks later");
    expect(parsed?.intent).toEqual({ action: "shift", target: "offline mode", days: 14 });
  });

  it("understands putting something in a release", () => {
    const parsed = parseIntent("put the invoice screen in Release 2");
    expect(parsed?.intent.action).toBe("release");
    if (parsed?.intent.action === "release") expect(parsed.intent.value).toBe("release 2");
  });

  it("understands merging two epics", () => {
    const parsed = parseIntent("merge the offline mode epic into the mobile notifications epic");
    expect(parsed?.intent.action).toBe("merge");
    if (parsed?.intent.action === "merge") {
      expect(parsed.intent.target).toBe("offline mode");
      expect(parsed.intent.into).toBe("mobile notifications");
    }
  });

  it("understands closing and reopening", () => {
    expect(parseIntent("close the Offline mode epic")?.intent).toEqual({ action: "close", target: "offline mode", reason: "COMPLETED" });
    expect(parseIntent("reopen the Offline mode epic")?.intent).toEqual({ action: "reopen", target: "offline mode" });
  });

  it("understands blocking", () => {
    const parsed = parseIntent("make the Offline mode story blocked by the Mobile notifications story");
    expect(parsed?.intent.action).toBe("block");
  });

  it("understands undo", () => {
    expect(parseIntent("undo that")?.intent).toEqual({ action: "undo" });
  });

  it("asks rather than guessing when a slot is missing", () => {
    const parsed = parseIntent("merge the offline mode epic into");
    expect(parsed?.missing?.slot).toBe("into");
    expect(parsed?.missing?.question).toContain("which epic");
  });

  it("says nothing when the phrase is not a command", () => {
    expect(parseIntent("what is the weather like")).toBeNull();
  });
});

describe("turning a command into changes", () => {
  it("moves the dates of the item it names", () => {
    const parsed = parseIntent("move the Offline mode epic two weeks later")!;
    const result = intentOps(project, mapping, parsed.intent, buildSchedule(project, mapping));
    expect(result.ops.length).toBe(1);
    expect(result.ops[0]!.kind).toBe("setDates");
    expect(result.label).toContain("Offline mode");
  });

  it("asks which item when the phrase does not say", () => {
    const parsed = parseIntent("merge the offline mode epic into")!;
    const result = intentOps(project, mapping, parsed.intent, buildSchedule(project, mapping));
    expect(result.ops).toHaveLength(0);
    expect(result.question).toContain("which epic");
  });

  it("merges two epics: the children move across and the smaller one is removed", () => {
    const into = title("Mobile notifications");
    const from = title("Offline mode");
    const ops = mergeEpics(project, into, from);
    expect(ops.length).toBeGreaterThan(1);
    expect(ops[ops.length - 1]).toMatchObject({ kind: "archive", key: from.key });
    const moves = ops.filter(o => o.kind === "setParent");
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every(o => o.kind === "setParent" && o.after === into.key)).toBe(true);
  });

  it("does not merge an epic into itself", () => {
    const epic = title("Offline mode");
    expect(mergeEpics(project, epic, epic)).toEqual([]);
  });

  it("makes an item wait for another", () => {
    const parsed = parseIntent("make the Offline mode story blocked by the Mobile notifications story")!;
    const result = intentOps(project, mapping, parsed.intent, buildSchedule(project, mapping));
    expect(result.ops[0]?.kind).toBe("addBlockedBy");
  });

  it("refuses a link that would close a loop", () => {
    const a = title("Offline mode");
    const b = title("Mobile notifications");
    a.blockedBy = [{ key: b.key, open: true }];
    const parsed = parseIntent("make the Mobile notifications story blocked by the Offline mode story")!;
    const result = intentOps(project, mapping, parsed.intent, buildSchedule(project, mapping));
    expect(result.ops).toHaveLength(0);
    expect(result.question).toContain("already waits");
  });
});

describe("filling in what a sentence left out", () => {
  it("puts the chosen item in the slot that was missing", () => {
    const intent = parseIntent("merge the offline mode epic into")!.intent;
    const filled = fillSlot(intent, "into", "mobile notifications");
    expect(filled).toEqual({ action: "merge", target: "offline mode", into: "mobile notifications" });
    const result = intentOps(project, mapping, filled, buildSchedule(project, mapping));
    expect(result.ops.length).toBeGreaterThan(0);
    expect(result.label).toContain("Offline mode");
  });

  it("knows which words a slot is waiting for", () => {
    const intent = parseIntent("make the offline mode story blocked by")!.intent;
    expect(slotPhrase(intent, "blocker")).toBe("");
    expect(slotPhrase(parseIntent("make the offline mode story blocked by the api story")!.intent, "blocker")).toBe("api");
  });
});
