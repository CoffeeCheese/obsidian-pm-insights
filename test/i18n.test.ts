import { afterEach, describe, expect, it, vi } from "vitest";
import { translations } from "../src/i18n";
import { DEFAULT_SETTINGS } from "../src/model";

describe("gate risk progress gap copy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["en", "13.16% schedule gap"],
    ["zh-cn", "进度落后 13.16%"]
  ] as const)("uses a percent sign in the %s locale", (locale, expected) => {
    vi.stubGlobal("document", { documentElement: { lang: "en" } });
    vi.stubGlobal("navigator", { language: "en" });

    const copy = translations({ ...structuredClone(DEFAULT_SETTINGS), locale });

    expect(copy.gateReasonScheduleGap(13.16)).toBe(expected);
  });
});
