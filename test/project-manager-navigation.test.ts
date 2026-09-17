import type { App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  Events: class {}
}));

import { ProjectManagerNavigator } from "../src/adapters/project-manager-navigation";

// Future values are synthetic: the native contract stays fixed while only the
// manifest version changes. These cases guard against reintroducing an allowlist.
const versions = [
  "1.8.0", "2.1.0", "2.2.0", "2.3.0", "2.3.1", "2.4.0", "2.4.1",
  "3.0.0", "99.0.0", "3.0.0-beta.1", "", undefined
];

describe("ProjectManagerNavigator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([false, true])("opens the same project after migration (same-ID task elsewhere: %s)", async (hasCopy) => {
    vi.stubGlobal("document", { querySelectorAll: vi.fn(() => []) });
    const currentPath = "Projects/Demo/Demo.md";
    const task = { id: "task-1", filePath: "Projects/Demo/_tasks/Task.md" };
    const nativeOpenTask = vi.fn();
    const view = { project: { tasks: [task] }, subview: { openTask: nativeOpenTask } };
    const navigator = new ProjectManagerNavigator({
      plugins: { getPlugin: () => ({
        index: {
          allTaskRefs: () => [
            { id: task.id, projectPath: currentPath },
            ...(hasCopy ? [{ id: task.id, projectPath: "Projects/Other/Other.md" }] : [])
          ],
          projectRefs: () => [{ id: "p1", path: currentPath }, { id: "p2", path: "Projects/Other/Other.md" }]
        }
      }) }
    } as unknown as App);
    const createView = vi.fn(async (path: string) => {
      if (path !== currentPath) throw new Error("The pre-migration project file no longer exists");
      return { leaf: {}, view };
    });
    const internals = navigator as unknown as {
      createDetachedProjectView: typeof createView;
      disposeDetachedProjectView: () => Promise<void>;
      waitFor: (read: () => unknown) => Promise<unknown>;
      waitForRemoval: () => Promise<void>;
    };
    internals.createDetachedProjectView = createView;
    internals.disposeDetachedProjectView = vi.fn(async () => undefined);
    internals.waitFor = vi.fn(async (read: () => unknown) => read() || {});
    internals.waitForRemoval = vi.fn(async () => undefined);

    await navigator.editTask({ taskId: task.id, projectPath: "Projects/Demo.md", projectId: "p1" });

    expect(createView).toHaveBeenCalledWith(currentPath);
    expect(nativeOpenTask).toHaveBeenCalledWith(task);
    expect(internals.disposeDetachedProjectView).toHaveBeenCalledOnce();
  });

  it("rejects a deleted task instead of opening the sole same-ID task in another project", async () => {
    vi.stubGlobal("document", { querySelectorAll: vi.fn(() => []) });
    const navigator = new ProjectManagerNavigator({
      plugins: { getPlugin: () => ({ index: {
        allTaskRefs: () => [{ id: "shared", projectPath: "Projects/B/B.md" }],
        projectRefs: () => [{ id: "a", path: "Projects/A/A.md" }, { id: "b", path: "Projects/B/B.md" }]
      } }) }
    } as unknown as App);
    const createView = vi.fn(async () => { throw new Error("Must not open another project's editor"); });
    (navigator as unknown as { createDetachedProjectView: typeof createView }).createDetachedProjectView = createView;
    await expect(navigator.editTask({ taskId: "shared", projectPath: "Projects/A.md", projectId: "a" }))
      .rejects.toMatchObject({ code: "task-not-found" });
    expect(createView).not.toHaveBeenCalled();
  });

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
