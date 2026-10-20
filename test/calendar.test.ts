// The working calendar: which days you can work in, and how that changes the plan.
import { describe, expect, it } from "vitest";
import { addWorkingDays, calendarOf, defaultCalendar, isWorkingDay, nextWorkingDay, previousWorkingDay, workingDaysBetween } from "../src/model/calendar";
import { detectMapping, type Mapping } from "../src/model/mapping";
import { normalizeProject, type Project } from "../src/model/normalize";
import { buildPlan } from "../src/model/plan/cpm";
import { buildSchedule } from "../src/model/schedule";

const cal = defaultCalendar;

describe("the working calendar", () => {
  it("knows a weekend", () => {
    // 2026-01-03 is a Saturday, 2026-01-04 a Sunday.
    expect(isWorkingDay("2026-01-02", cal)).toBe(true);
    expect(isWorkingDay("2026-01-03", cal)).toBe(false);
    expect(isWorkingDay("2026-01-04", cal)).toBe(false);
    expect(isWorkingDay("2026-01-05", cal)).toBe(true);
  });

  it("knows a holiday, whatever the week says", () => {
    const withHoliday = { workingDays: [1, 2, 3, 4, 5], holidays: ["2026-01-05"] };
    expect(isWorkingDay("2026-01-05", withHoliday)).toBe(false);
    expect(nextWorkingDay("2026-01-05", withHoliday)).toBe("2026-01-06");
    expect(previousWorkingDay("2026-01-05", withHoliday)).toBe("2026-01-02");
  });

  it("counts working days, not calendar days", () => {
    expect(workingDaysBetween("2026-01-01", "2026-01-11", cal)).toBe(7);
    expect(workingDaysBetween("2026-01-05", "2026-01-12", cal)).toBe(5);
  });

  it("steps over the weekend", () => {
    // Friday plus one working day is Monday.
    expect(addWorkingDays("2026-01-02", 1, cal)).toBe("2026-01-05");
    expect(addWorkingDays("2026-01-05", -1, cal)).toBe("2026-01-02");
  });

  it("falls back for mappings saved before the calendar existed", () => {
    const old = { ...detectMapping({ items: [], fields: [] } as unknown as Project) } as Mapping;
    (old as { workingDays?: number[] }).workingDays = undefined;
    expect(calendarOf(old).workingDays).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("the plan in working days", () => {
  const meta = {
    id: "P", number: 1, title: "t", url: "", shortDescription: null, closed: false, updatedAt: "2026-01-01T00:00:00Z",
    items: { totalCount: 2 },
    fields: { nodes: [
      { __typename: "ProjectV2Field", id: "f-start", name: "Start date", dataType: "DATE" },
      { __typename: "ProjectV2Field", id: "f-end", name: "Target date", dataType: "DATE" }] },
  };
  const raw = (n: number, title: string, start: string, end: string, blockedBy: number | null) => ({
    id: `item-${n}`, type: "ISSUE", isArchived: false, fieldValues: { nodes: [
      { __typename: "ProjectV2ItemFieldDateValue", date: start, field: { id: "f-start", name: "Start date" } },
      { __typename: "ProjectV2ItemFieldDateValue", date: end, field: { id: "f-end", name: "Target date" } }] },
    content: {
      __typename: "Issue", id: `I_${n}`, number: n, title, body: "", url: "", state: "OPEN", stateReason: null,
      createdAt: "2026-01-01T00:00:00Z", closedAt: null, updatedAt: "2026-01-01T00:00:00Z",
      repository: { nameWithOwner: "o/r" }, labels: { nodes: [{ id: "L", name: "type: epic", color: "f" }] },
      assignees: { nodes: [] }, milestone: null, issueType: null, parent: null,
      subIssuesSummary: { total: 0, completed: 0 },
      blockedBy: { nodes: blockedBy ? [{ id: `I_${blockedBy}`, number: blockedBy, state: "OPEN", repository: { nameWithOwner: "o/r" } }] : [] },
    },
  });
  const project = normalizeProject("o", meta as never, [raw(1, "A", "2026-01-01", "2026-01-02", null), raw(2, "B", "2026-01-05", "2026-01-09", 1)] as never, "2026-01-01T00:00:00Z");
  const mapping = detectMapping(project);

  it("does not let work start on a Saturday", () => {
    const plan = buildPlan(project, mapping, buildSchedule(project, mapping));
    const b = plan.epics.get("o/r#2")!;
    // B waits for A, which finishes on Friday, so B starts on Monday.
    expect(b.earliest).toBe("2026-01-05");
    expect(b.workDays).toBe(5);
    expect(b.days).toBe(5);
  });

  it("counts the days you can work in", () => {
    const plan = buildPlan(project, mapping, buildSchedule(project, mapping));
    const a = plan.epics.get("o/r#1")!;
    // Thursday and Friday.
    expect(a.workDays).toBe(2);
  });
});
