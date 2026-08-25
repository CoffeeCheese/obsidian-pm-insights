import { describe, expect, it } from "vitest";
import { validateGateSchedule } from "../src/domain/gate-schedule";
import type { ProjectGateSchedule } from "../src/model";

const schedule = (overrides: Partial<ProjectGateSchedule> = {}): ProjectGateSchedule => ({
  startDate: "2026-08-01",
  stageGates: {
    discovery: "2026-08-05",
    delivery: "2026-08-12"
  },
  acceptanceGate: "2026-08-15",
  launchDate: "2026-08-15",
  includeWeekends: true,
  ...overrides
});

describe("validateGateSchedule", () => {
  it("accepts complete ordered date-only gates and allows adjacent dates to match", () => {
    expect(validateGateSchedule(schedule(), ["discovery", "delivery"])).toEqual({
      valid: true,
      missing: [],
      invalid: [],
      outOfOrder: false
    });
  });

  it("reports missing stage gates without treating the schedule as safe", () => {
    const result = validateGateSchedule(schedule({
      stageGates: { discovery: "2026-08-05" }
    }), ["discovery", "delivery"]);

    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(["delivery"]);
  });

  it("rejects invalid calendar dates and reversed gate order", () => {
    const invalidDate = validateGateSchedule(schedule({ startDate: "2026-02-30" }), [
      "discovery",
      "delivery"
    ]);
    expect(invalidDate.invalid).toEqual(["start"]);

    const reversed = validateGateSchedule(schedule({
      stageGates: { discovery: "2026-08-13", delivery: "2026-08-12" }
    }), ["discovery", "delivery"]);
    expect(reversed.outOfOrder).toBe(true);
  });
});
