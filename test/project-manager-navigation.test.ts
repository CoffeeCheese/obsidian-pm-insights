import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  Events: class {}
}));

import { ProjectManagerNavigator } from "../src/adapters/project-manager-navigation";

describe("ProjectManagerNavigator", () => {
  it("uses a Kanban bridge when the default project subview cannot open tasks", async () => {
    vi.stubGlobal("document", { querySelectorAll: vi.fn(() => []) });

    const app = {
      plugins: {
        getPlugin: vi.fn(() => ({ manifest: { version: "1.8.0" } }))
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
  });
});
