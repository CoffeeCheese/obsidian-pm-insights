import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import {
  openProjectManagerCommunityPage,
  PROJECT_MANAGER_LISTING_URI,
  projectManagerDependencyState
} from "../src/project-manager-dependency";

function appWithPlugins(plugins: unknown): App {
  return { plugins } as unknown as App;
}

describe("Project Manager dependency", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports ready when Project Manager is loaded", () => {
    const app = appWithPlugins({
      manifests: {},
      getPlugin: (id: string) => id === "project-manager" ? {} : null
    });

    expect(projectManagerDependencyState(app)).toBe("ready");
  });

  it("distinguishes an installed but disabled plugin", () => {
    const app = appWithPlugins({
      manifests: { "project-manager": { id: "project-manager" } },
      getPlugin: () => null
    });

    expect(projectManagerDependencyState(app)).toBe("disabled");
  });

  it("reports a missing dependency when no manifest is installed", () => {
    const app = appWithPlugins({ manifests: {}, getPlugin: () => null });

    expect(projectManagerDependencyState(app)).toBe("missing");
  });

  it("does not guess when the plugin registry is unavailable", () => {
    expect(projectManagerDependencyState({} as App)).toBe("unknown");
    expect(projectManagerDependencyState(appWithPlugins({ getPlugin: () => null }))).toBe("unknown");
  });

  it("opens the official Project Manager community page", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });

    openProjectManagerCommunityPage();

    expect(open).toHaveBeenCalledWith(PROJECT_MANAGER_LISTING_URI);
  });
});
