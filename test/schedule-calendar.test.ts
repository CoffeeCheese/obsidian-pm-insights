import { describe, expect, it } from "vitest";
import {
  scheduleDaysBetween,
  stageWindowDaysBetween
} from "../src/domain/schedule-calendar";

describe("scheduleDaysBetween", () => {
  it("counts every crossed date when weekends are included", () => {
    expect(scheduleDaysBetween("2026-08-01", "2026-08-11", true)).toBe(10);
  });

  it("keeps the project clock still on weekends when they are excluded", () => {
    expect(scheduleDaysBetween("2026-08-01", "2026-08-07", false)).toBe(5);
    expect(scheduleDaysBetween("2026-08-01", "2026-08-08", false)).toBe(5);
    expect(scheduleDaysBetween("2026-08-01", "2026-08-11", false)).toBe(7);
  });

  it("preserves the sign when counting backwards", () => {
    expect(scheduleDaysBetween("2026-08-11", "2026-08-08", false)).toBe(-2);
  });

  it("reports zero workdays across a weekend without pretending the dates match", () => {
    expect(scheduleDaysBetween("2026-08-07", "2026-08-09", false)).toBe(0);
  });
});

describe("stageWindowDaysBetween", () => {
  it("keeps the elapsed clock unchanged when the same-day rule is disabled", () => {
    expect(stageWindowDaysBetween("2026-09-08", "2026-09-08", false, false)).toBe(0);
  });

  it("keeps one eligible project-clock day for enabled same-day gates", () => {
    expect(stageWindowDaysBetween("2026-09-08", "2026-09-08", false, true)).toBe(1);
    expect(stageWindowDaysBetween("2026-09-12", "2026-09-12", true, true)).toBe(1);
  });

  it("does not invent a workday on an excluded weekend", () => {
    expect(stageWindowDaysBetween("2026-09-12", "2026-09-12", false, true)).toBe(0);
  });

  it("does not change non-same-day stage windows", () => {
    expect(stageWindowDaysBetween("2026-09-01", "2026-09-07", false, true)).toBe(4);
    expect(stageWindowDaysBetween("2026-09-01", "2026-09-07", false, false)).toBe(4);
  });
});
