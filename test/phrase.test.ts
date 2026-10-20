// Dates in words, and the model reading a sentence the grammar could not.
import { describe, expect, it } from "vitest";
import { parseDate } from "../src/model/command/dates";
import { checkIntent, toIntent } from "../src/model/command/phrase";
import { parseIntent, setToday } from "../src/model/command/intent";

describe("dates in words", () => {
  const today = "2026-10-19"; // a Monday
  it("knows today and tomorrow", () => {
    expect(parseDate("today", today)?.date).toBe("2026-10-19");
    expect(parseDate("tomorrow", today)?.date).toBe("2026-10-20");
  });

  it("knows the next Friday", () => {
    expect(parseDate("next Friday", today)?.date).toBe("2026-10-23");
    expect(parseDate("friday", today)?.date).toBe("2026-10-23");
  });

  it("knows a day of the month", () => {
    // The twentieth is still to come this month.
    expect(parseDate("the 20th", today)?.date).toBe("2026-10-20");
    // The fifteenth has gone, so it means the same day next month.
    expect(parseDate("the 15th", today)?.date).toBe("2026-11-15");
  });

  it("knows the end of the month", () => {
    expect(parseDate("end of the month", today)?.date).toBe("2026-10-31");
  });

  it("says nothing when no day is named", () => {
    expect(parseDate("a week later", today)).toBeNull();
  });

  it("puts an item's end on the day someone said", () => {
    setToday("2026-10-19");
    const parsed = parseIntent("move the Offline mode epic to the 25th");
    expect(parsed?.intent.action).toBe("setDate");
    if (parsed?.intent.action === "setDate") expect(parsed.intent.date).toBe("2026-10-25");
  });
});

describe("a model reading a sentence", () => {
  it("only accepts the actions that exist", () => {
    expect(checkIntent({ action: "shift", target: "o/r#1", days: 7 })).toBe(true);
    expect(checkIntent({ action: "destroy", target: "o/r#1" })).toBe(false);
    expect(checkIntent({ action: "shift", target: 5 })).toBe(false);
    expect(checkIntent({ action: "shift", days: "seven" })).toBe(false);
    expect(checkIntent(null)).toBe(false);
  });

  it("throws away a target that is not in the project", () => {
    const known = (k: string) => k === "o/r#1";
    expect(toIntent({ action: "shift", target: "o/r#1", days: 7 }, known)).toEqual({ action: "shift", target: "o/r#1", days: 7 });
    expect(toIntent({ action: "shift", target: "o/r#99", days: 7 }, known)).toBeNull();
    expect(toIntent({ action: "shift", target: "o/r#1" }, known)).toBeNull();
  });

  it("throws away a merge that names only one side", () => {
    const known = (k: string) => k === "o/r#1";
    expect(toIntent({ action: "merge", target: "o/r#1" }, known)).toBeNull();
    expect(toIntent({ action: "merge", target: "o/r#1", into: "o/r#2" }, known)).toBeNull();
  });

  it("keeps an undo, which needs no target", () => {
    expect(toIntent({ action: "undo" }, () => false)).toEqual({ action: "undo" });
  });
});
