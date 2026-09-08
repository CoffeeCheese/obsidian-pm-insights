import type { App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  Events: class {}
}));

import { ProjectManagerNavigator } from "../src/adapters/project-manager-navigation";

// Future values are synthetic: the native contract stays fixed while only the
// manifest version changes. These cases guard against reintroducing an allowlist.
const versions = [
  "1.8.0", "2.1.0", "2.2.0", "2.3.0", "2.3.1", "2.4.0",
  "3.0.0", "99.0.0", "3.0.0-beta.1", "", undefined
];

describe("ProjectManagerNavigator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(versions)(
    "uses a Kanban bridge with Project Manager %s when the default project subview cannot open tasks",
    async (projectManagerVersion) => {
      vi.stubGlobal("document", { querySelectorAll: vi.fn(() => []) });

      const app = {
        plugins: {
          getPlugin: vi.fn(() => ({ manifest: { version: projectManagerVersion } }))
        }
      } as unknown as App;
      const navigator = new ProjectManagerNavigator(app);
      const nativeOpenTask = vi.fn();
      const renderCurrentView = vi.fn(function (this: {
        subview: { openTask?: (task: { id: string }) => void };
      }) {
        this.subview = { openTask: nativeOpenTask };
      });
      const view = {
        currentView: "gantt",
        subview: {},
        renderCurrentView
      };
      const task = { id: "task-1" };
      const fakeModal = {} as HTMLElement;
      const findTaskButton = vi.fn(async () => null);
      const waitForRemoval = vi.fn(async () => undefined);
      const disposeDetachedProjectView = vi.fn(async () => undefined);
      const internals = navigator as unknown as {
        createDetachedProjectView: () => Promise<{ leaf: object; view: typeof view }>;
        findProjectTask: () => Promise<typeof task>;
        findTaskButton: typeof findTaskButton;
        waitFor: () => Promise<HTMLElement>;
        waitForRemoval: typeof waitForRemoval;
        disposeDetachedProjectView: typeof disposeDetachedProjectView;
      };
      internals.createDetachedProjectView = vi.fn(async () => ({ leaf: {}, view }));
      internals.findProjectTask = vi.fn(async () => task);
      internals.findTaskButton = findTaskButton;
      internals.waitFor = vi.fn(async () => fakeModal);
      internals.waitForRemoval = waitForRemoval;
      internals.disposeDetachedProjectView = disposeDetachedProjectView;

      await expect(
        navigator.editTask({ projectPath: "Projects/project.md", taskId: task.id })
      ).resolves.toBeUndefined();

      expect(view.currentView).toBe("kanban");
      expect(renderCurrentView).toHaveBeenCalledOnce();
      expect(nativeOpenTask).toHaveBeenCalledWith(task);
      expect(findTaskButton).not.toHaveBeenCalled();
      expect(waitForRemoval).toHaveBeenCalledWith(fakeModal);
      expect(disposeDetachedProjectView).toHaveBeenCalledOnce();
    }
  );

  it.each(versions)("honors the native tab editor capability with version %s without waiting for a modal", async (version) => {
    vi.stubGlobal("document", { querySelectorAll: vi.fn(() => []) });
    const openTask = vi.fn(async () => undefined);
    const plugin = {
      manifest: { version },
      settings: { taskEditorSurface: "tab" },
      router: { openTask }
    };
    const navigator = new ProjectManagerNavigator({
      plugins: { getPlugin: () => plugin }
    } as unknown as App);
    const task = { id: "nested", filePath: "Projects/project/_tasks/nested.md" };
    const nativeOpenTask = vi.fn();
    const view = {
      project: { tasks: [{ id: "root", subtasks: [task] }] },
      subview: { openTask: nativeOpenTask }
    };
    const dispose = vi.fn(async () => undefined);
    const internals = navigator as unknown as {
      createDetachedProjectView: () => Promise<{ leaf: object; view: typeof view }>;
      disposeDetachedProjectView: typeof dispose;
      waitFor: (read: () => unknown) => Promise<unknown>;
    };
    internals.createDetachedProjectView = vi.fn(async () => ({ leaf: {}, view }));
    internals.disposeDetachedProjectView = dispose;
    internals.waitFor = vi.fn(async (read: () => unknown) => read());

    await expect(navigator.editTask({ projectPath: "Projects/project.md", taskId: task.id }))
      .resolves.toBeUndefined();

    expect(openTask).toHaveBeenCalledWith({ filePath: task.filePath });
    expect(nativeOpenTask).not.toHaveBeenCalled();
    expect(internals.waitFor).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it.each(["2.3.1", "99.0.0"])("reports missing editor capabilities with version %s and allows a subsequent retry", async (version) => {
    vi.stubGlobal("document", { querySelectorAll: vi.fn(() => []) });
    const getViewCreatorByType = vi.fn(() => null);
    const navigator = new ProjectManagerNavigator({
      plugins: { getPlugin: () => ({ manifest: { version } }) },
      viewRegistry: { getViewCreatorByType }
    } as unknown as App);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(navigator.editTask({ projectPath: "Projects/project.md", taskId: "task" }))
        .rejects.toMatchObject({ code: "task-editor-unavailable" });
    }
    expect(getViewCreatorByType).toHaveBeenCalledTimes(2);
  });
});
