import { describe, expect, it, vi } from "vitest";
import { SettingsWriter } from "../src/settings-writer";
import { DEFAULT_SETTINGS, type InsightSettings } from "../src/model";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("serialized settings persistence", () => {
  it("publishes after saving, then applies queued edits to the latest state", async () => {
    let settings = structuredClone(DEFAULT_SETTINGS);
    const saving = deferred(); const started = deferred();
    const saved: InsightSettings[] = [];
    const writer = new SettingsWriter({
      read: () => settings,
      write: async (draft) => { started.resolve(); await saving.promise; saved.push(structuredClone(draft)); },
      publish: (draft) => { settings = draft; }
    });
    const launch = writer.transact((draft) => {
      draft.gateActuals.p1 = { gates: {}, events: [], launchDate: "2026-09-10" };
    });
    await started.promise;
    expect(settings.gateActuals.p1).toBeUndefined();
    const preference = writer.transact((draft) => { draft.locale = "zh-cn"; });
    saving.resolve();
    await Promise.all([launch, preference]);
    expect(settings.locale).toBe("zh-cn");
    expect(settings.gateActuals.p1?.launchDate).toBe("2026-09-10");
    expect(saved).toHaveLength(2);
    expect(saved[1]?.gateActuals.p1?.launchDate).toBe("2026-09-10");
  });

  it("leaves memory unchanged after failure and allows retry", async () => {
    let settings = structuredClone(DEFAULT_SETTINGS);
    const write = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);
    const writer = new SettingsWriter({ read: () => settings, write, publish: (draft) => { settings = draft; } });
    const edit = (draft: InsightSettings) => { draft.locale = "zh-cn"; };
    await expect(writer.transact(edit)).rejects.toThrow("disk full");
    expect(settings.locale).toBe(DEFAULT_SETTINGS.locale);
    await writer.transact(edit);
    expect(settings.locale).toBe("zh-cn");
  });

  it("does not write unchanged decisions and preserves later unrelated edits", async () => {
    let settings = structuredClone(DEFAULT_SETTINGS);
    const write = vi.fn().mockResolvedValue(undefined);
    const writer = new SettingsWriter({ read: () => settings, write, publish: (draft) => { settings = draft; } });
    await writer.transact(() => ({ kind: "unchanged" }));
    expect(write).not.toHaveBeenCalled();
    await expect(writer.transact(() => { throw new Error("rejected"); })).rejects.toThrow("rejected");
    await writer.transact((draft) => { draft.includeArchived = !draft.includeArchived; });
    expect(settings.includeArchived).not.toBe(DEFAULT_SETTINGS.includeArchived);
  });
});
