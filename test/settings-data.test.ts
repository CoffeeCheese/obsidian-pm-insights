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

  it("falls back safely when the saved visibility value is invalid", () => {
    const saved = {
      ...structuredClone(DEFAULT_SETTINGS),
      showDeliveryProgress: "hidden"
    } as unknown as Partial<InsightSettings>;

    expect(normalizeInsightSettings(saved).showDeliveryProgress).toBe(true);
  });
});
