import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type InsightSettings } from "../src/model";
import { normalizeInsightSettings } from "../src/settings-data";

describe("normalizeInsightSettings", () => {
  it("shows delivery progress by default for existing installations", () => {
    expect(normalizeInsightSettings(null).showDeliveryProgress).toBe(true);
    expect(normalizeInsightSettings({ locale: "zh-cn" }).showDeliveryProgress).toBe(true);
  });

  it("preserves a saved hidden delivery progress preference", () => {
    expect(normalizeInsightSettings({ showDeliveryProgress: false }).showDeliveryProgress).toBe(false);
  });

  it("keeps task due-date checks enabled unless users disable them", () => {
    expect(normalizeInsightSettings(null).gateRisk.checkTaskDueDates).toBe(true);
    expect(normalizeInsightSettings({ gateRisk: { checkTaskDueDates: false } })
      .gateRisk.checkTaskDueDates).toBe(false);
    expect(normalizeInsightSettings({
      gateRisk: { checkTaskDueDates: "sometimes" }
    } as unknown as Partial<InsightSettings>).gateRisk.checkTaskDueDates).toBe(true);
  });

  it("keeps completed-root prerequisite validation enabled unless users disable it", () => {
    expect(normalizeInsightSettings(null).deliveryProgress.validateCompletedRootPrerequisites)
      .toBe(true);
    expect(normalizeInsightSettings({
      deliveryProgress: {
        ...structuredClone(DEFAULT_SETTINGS.deliveryProgress),
        validateCompletedRootPrerequisites: false
      }
    }).deliveryProgress.validateCompletedRootPrerequisites).toBe(false);
    expect(normalizeInsightSettings({
      deliveryProgress: {
        ...structuredClone(DEFAULT_SETTINGS.deliveryProgress),
        validateCompletedRootPrerequisites: "sometimes"
      }
    } as unknown as Partial<InsightSettings>).deliveryProgress.validateCompletedRootPrerequisites)
      .toBe(true);
  });

  it("falls back safely when the saved visibility value is invalid", () => {
    const saved = {
      ...structuredClone(DEFAULT_SETTINGS),
      showDeliveryProgress: "hidden"
    } as unknown as Partial<InsightSettings>;

    expect(normalizeInsightSettings(saved).showDeliveryProgress).toBe(true);
  });

  it("migrates the fixed delivery stages to an ordered stage list", () => {
    const migrated = normalizeInsightSettings({
      deliveryProgress: {
        stages: {
          design: {
            tags: ["type/ux"],
            weight: 15,
            acceptancePrerequisite: true,
            skipWhenEmpty: false
          },
          development: {
            tags: ["type/code"],
            weight: 45,
            acceptancePrerequisite: true,
            skipWhenEmpty: false
          },
          testing: {
            tags: ["type/qa"],
            weight: 30,
            acceptancePrerequisite: true,
            skipWhenEmpty: true
          }
        },
        acceptanceWeight: 10
      }
    } as unknown as Partial<InsightSettings>);

    expect(migrated.deliveryProgress.stages).toEqual([
      expect.objectContaining({ id: "design", name: "", tags: ["type/ux"], weight: 15 }),
      expect.objectContaining({ id: "development", name: "", tags: ["type/code"], weight: 45 }),
      expect.objectContaining({ id: "testing", name: "", tags: ["type/qa"], weight: 30 })
    ]);
  });

  it("preserves ordered custom stages with stable identities", () => {
    const saved = structuredClone(DEFAULT_SETTINGS);
    saved.deliveryProgress.stages = [
      {
        id: "discovery",
        name: "Discovery",
        tags: ["type/discovery"],
        weight: 20,
        acceptancePrerequisite: false,
        skipWhenEmpty: true
      },
      {
        id: "delivery",
        name: "Delivery",
        tags: ["type/delivery"],
        weight: 70,
        acceptancePrerequisite: true,
        skipWhenEmpty: false
      }
    ];

    expect(normalizeInsightSettings(saved).deliveryProgress.stages).toEqual(
      saved.deliveryProgress.stages
    );
  });

  it("normalizes project gate schedules without discarding orphaned projects", () => {
    const normalized = normalizeInsightSettings({
      gateSchedules: {
        "project-one": {
          startDate: "2026-08-01",
          stageGates: { design: "2026-08-05", development: "2026-08-12" },
          acceptanceGate: "2026-08-18",
          launchDate: "2026-08-20",
          includeWeekends: false
        },
        "temporarily-missing": {
          startDate: "2026-09-01",
          stageGates: {},
          acceptanceGate: "",
          launchDate: "",
          includeWeekends: true
        }
      }
    });

    expect(normalized.gateSchedules["project-one"]).toEqual({
      startDate: "2026-08-01",
      stageGates: { design: "2026-08-05", development: "2026-08-12" },
      acceptanceGate: "2026-08-18",
      launchDate: "2026-08-20",
      includeWeekends: false
    });
    expect(normalized.gateSchedules["temporarily-missing"]).toBeDefined();
  });

  it("keeps legacy project gates on calendar days until users change the rule", () => {
    const normalized = normalizeInsightSettings({
      gateSchedules: {
        legacy: {
          startDate: "2026-08-01",
          stageGates: { development: "2026-08-12" },
          acceptanceGate: "2026-08-18",
          launchDate: "2026-08-20"
        }
      }
    } as unknown as Partial<InsightSettings>);

    expect(normalized.gateSchedules.legacy?.includeWeekends).toBe(true);
  });

  it("normalizes delay revisions and actual gate events independently from baselines", () => {
    const normalized = normalizeInsightSettings({
      gateDelays: {
        p1: {
          status: "confirmed",
          confirmed: {
            stageGates: { development: "2026-08-15" },
            acceptanceGate: "2026-08-18",
            launchDate: "2026-08-20"
          },
          revisions: [{
            id: "r1",
            createdAt: "2026-08-10T09:00:00.000Z",
            decidedAt: "2026-08-10T10:00:00.000Z",
            kind: "confirmed",
            reason: "Vendor delay",
            withdrawnAt: "2026-08-11T09:00:00.000Z",
            forecast: {
              stageGates: { development: "2026-08-15" },
              acceptanceGate: "2026-08-18",
              launchDate: "2026-08-20"
            },
            stages: [{ id: "development", name: "Development", order: 0 }],
            changes: { development: "manual", acceptance: "linked", launch: "linked" }
          }]
        }
      },
      gateActuals: {
        p1: {
          gates: {
            development: {
              date: "2026-08-14",
              source: "tasks",
              recordedAt: "2026-08-14T09:00:00.000Z",
              open: false
            }
          },
          events: [{
            id: "e1",
            createdAt: "2026-08-14T09:00:00.000Z",
            kind: "passed",
            gateId: "development",
            date: "2026-08-14",
            source: "tasks"
          }]
        }
      }
    });

    expect(normalized.gateDelays.p1?.revisions[0]).toMatchObject({
      kind: "confirmed",
      reason: "Vendor delay",
      decidedAt: "2026-08-10T10:00:00.000Z",
      withdrawnAt: "2026-08-11T09:00:00.000Z",
      changes: { development: "manual", acceptance: "linked", launch: "linked" }
    });
    expect(normalized.gateActuals.p1?.gates.development).toMatchObject({
      date: "2026-08-14",
      source: "tasks",
      open: false
    });
  });
});
