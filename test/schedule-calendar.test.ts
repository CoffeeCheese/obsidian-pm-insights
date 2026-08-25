import { describe, expect, it } from "vitest";
import { scheduleDaysBetween } from "../src/domain/schedule-calendar";

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
