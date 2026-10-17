import { describe, expect, it } from "vitest";
import { axis, quarterLabel } from "../src/model/axis";

describe("quarterLabel", () => {
  it("uses calendar quarters by default", () => {
    expect(quarterLabel("2026-10-19", 1)).toBe("2026 Q4");
    expect(quarterLabel("2027-01-04", 1)).toBe("2027 Q1");
  });
  it("supports the US federal fiscal year (starts Oct 1)", () => {
    expect(quarterLabel("2026-10-01", 10)).toBe("FY27 Q1");
    expect(quarterLabel("2026-09-30", 10)).toBe("FY26 Q4");
    expect(quarterLabel("2027-01-15", 10)).toBe("FY27 Q2");
  });
  it("supports a July fiscal year", () => {
    expect(quarterLabel("2026-07-01", 7)).toBe("FY27 Q1");
    expect(quarterLabel("2026-06-30", 7)).toBe("FY26 Q4");
  });
});

describe("axis", () => {
  it("covers every day exactly once in each row", () => {
    const a = axis("2026-10-12", "2027-03-28", 10);
    const sum = (xs: { days: number }[]) => xs.reduce((n, s) => n + s.days, 0);
    expect(sum(a.quarters)).toBe(a.days);
    expect(sum(a.months)).toBe(a.days);
    expect(sum(a.weeks)).toBe(a.days);
    expect(a.quarters.map(q => q.label)).toEqual(["FY27 Q1", "FY27 Q2"]);
    expect(a.months[0]).toEqual({ label: "Oct 2026", start: "2026-10-12", days: 20 });
  });
});
