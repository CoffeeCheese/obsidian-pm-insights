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

describe("personal delivery ledger copy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["en", "Compared with 9 team members", "Team reference: 25%"],
    ["zh-cn", "与团队 9 人对比", "团队参考：25%"]
  ] as const)("uses plain-language team references in the %s locale", (
    locale,
    sample,
    reference
  ) => {
    vi.stubGlobal("document", { documentElement: { lang: "en" } });
    vi.stubGlobal("navigator", { language: "en" });

    const copy = translations({ ...structuredClone(DEFAULT_SETTINGS), locale });
    const visibleCopy = [
      copy.teamReferenceSample(9),
      copy.compactTeamReference(25),
      copy.projectSpreadComparison(2, 1),
      copy.sharedWorkComparison(20, 15),
      copy.highPriorityComparison(30, 25)
    ].join(" ");

    expect(copy.teamReferenceSample(9)).toBe(sample);
    expect(copy.compactTeamReference(25)).toBe(reference);
    expect(copy.teamReferenceMethod(9)).toMatch(/middle|中间/u);
    expect(visibleCopy).not.toMatch(/median|中位|n=/iu);
  });
});
