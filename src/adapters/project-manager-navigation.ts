import { Events, type App } from "obsidian";

const PROJECT_MANAGER_ID = "project-manager";
const PROJECT_VIEW_TYPE = "pm-project";
const COMPATIBLE_VERSION = /^1\.8\./u;
const RENDER_TIMEOUT_MS = 2_500;
const POLL_INTERVAL_MS = 40;

interface ProjectManagerRouter {
  openProjectByPath(path: string): Promise<void> | void;
}

interface ProjectManagerPlugin {
  manifest?: { version?: string };
  router?: ProjectManagerRouter;
}

interface PluginRegistry {
  getPlugin(id: string): unknown;
}

interface ProjectTask {
  id?: string;
  collapsed?: boolean;
  subtasks?: ProjectTask[];
}

interface ProjectTableRow {
  task?: { id?: string };
}

interface ProjectTableState {
  filter?: { showArchived?: boolean };
  visibleRows?: ProjectTableRow[];
  wrapper?: HTMLElement;
  rowHeight?: number;
}

interface ProjectTableView {
  state?: ProjectTableState;
  refresh?(): Promise<void> | void;
}

interface ProjectManagerProjectView {
  containerEl: HTMLElement;
  filter?: { showArchived?: boolean };
  project?: { tasks?: ProjectTask[] };
  subview?: ProjectTableView;
  load?(): void;
  unload?(): void;
  onOpen?(): Promise<void> | void;
  onClose?(): Promise<void> | void;
  setState?(state: { filePath: string }, result: Record<string, never>): Promise<void> | void;
}

interface ProjectViewRegistry {
  getViewCreatorByType?(type: string):
    | ((leaf: DetachedProjectLeaf) => ProjectManagerProjectView)
    | null;
}

class DetachedProjectLeaf extends Events {
  readonly containerEl: HTMLElement;
  readonly history = { backHistory: [], forwardHistory: [] };
  private readonly rootEl: HTMLElement;

  constructor(readonly app: App) {
    super();
    this.rootEl = createDiv("pmi-detached-project-host");
    this.rootEl.setAttribute("aria-hidden", "true");
    this.rootEl.append(createDiv());

    this.containerEl = createDiv("pmi-detached-project-container");
    this.containerEl.append(createDiv(), createDiv());
    this.rootEl.append(this.containerEl);
    document.body.append(this.rootEl);
  }

  updateHeader(): void {}

  destroy(): void {
    this.rootEl.remove();
  }
}

type NavigationFailureCode =
  | "plugin-unavailable"
  | "unsupported-version"
  | "project-router-unavailable"
  | "task-not-found"
  | "task-editor-unavailable";

export class ProjectManagerNavigationError extends Error {
  constructor(readonly code: NavigationFailureCode) {
    super(code);
    this.name = "ProjectManagerNavigationError";
  }
}

export interface ProjectManagerTaskTarget {
  projectPath: string;
  taskId: string;
}

export class ProjectManagerNavigator {
  private openingTask = false;

  constructor(private readonly app: App) {}

  async openProject(projectPath: string): Promise<void> {
    const plugin = this.plugin();
    if (!plugin.router?.openProjectByPath) {
      throw new ProjectManagerNavigationError("project-router-unavailable");
    }
    await plugin.router.openProjectByPath(projectPath);
  }

  async editTask(target: ProjectManagerTaskTarget): Promise<void> {
    if (this.openingTask) return;
    this.openingTask = true;

    let detachedLeaf: DetachedProjectLeaf | null = null;
    let projectView: ProjectManagerProjectView | null = null;

    try {
      const plugin = this.plugin();
      if (!COMPATIBLE_VERSION.test(plugin.manifest?.version ?? "")) {
        throw new ProjectManagerNavigationError("unsupported-version");
      }

      const existingModals = new Set(document.querySelectorAll(".modal-container"));
      ({ leaf: detachedLeaf, view: projectView } = await this.createDetachedProjectView(
        target.projectPath
      ));
      const taskButton = await this.findTaskButton(projectView, target.taskId);
      if (!taskButton) throw new ProjectManagerNavigationError("task-not-found");

      taskButton.click();
      const modal = await this.waitFor(() =>
        [...document.querySelectorAll<HTMLElement>(".modal-container")].find(
          (candidate) => !existingModals.has(candidate)
        )
      );
      if (!modal) throw new ProjectManagerNavigationError("task-editor-unavailable");
      await this.waitForRemoval(modal);
    } finally {
      try {
        if (detachedLeaf) await this.disposeDetachedProjectView(detachedLeaf, projectView);
      } finally {
        this.openingTask = false;
      }
    }
  }

  private async createDetachedProjectView(
    projectPath: string
  ): Promise<{ leaf: DetachedProjectLeaf; view: ProjectManagerProjectView }> {
    const registry = (this.app as App & { viewRegistry?: ProjectViewRegistry }).viewRegistry;
    const createView = registry?.getViewCreatorByType?.(PROJECT_VIEW_TYPE);
    if (!createView) throw new ProjectManagerNavigationError("task-editor-unavailable");

    const leaf = new DetachedProjectLeaf(this.app);
    let view: ProjectManagerProjectView | null = null;
    try {
      view = createView(leaf);
      if (!view.setState) throw new ProjectManagerNavigationError("task-editor-unavailable");
      view.load?.();
      await view.onOpen?.();
      await view.setState({ filePath: projectPath }, {});
      return { leaf, view };
    } catch (error) {
      await this.disposeDetachedProjectView(leaf, view).catch(() => undefined);
      throw error;
    }
  }

  private async disposeDetachedProjectView(
    leaf: DetachedProjectLeaf,
    view: ProjectManagerProjectView | null
  ): Promise<void> {
    try {
      await view?.onClose?.();
    } finally {
      try {
        view?.unload?.();
      } finally {
        leaf.destroy();
      }
    }
  }

  private plugin(): ProjectManagerPlugin {
    const registry = (this.app as App & { plugins?: PluginRegistry }).plugins;
    const plugin = registry?.getPlugin(PROJECT_MANAGER_ID) as ProjectManagerPlugin | null;
    if (!plugin) throw new ProjectManagerNavigationError("plugin-unavailable");
    return plugin;
  }

  private async findTaskButton(
    view: ProjectManagerProjectView,
    taskId: string
  ): Promise<HTMLElement | null> {
    const ready = await this.waitFor(() => view.project && view.subview?.state);
    if (!ready) return null;

    this.revealAllTasks(view);
    await view.subview?.refresh?.();

    const firstAttempt = await this.waitFor(() => this.taskButton(view.containerEl, taskId), 400);
    if (firstAttempt) return firstAttempt;

    const state = view.subview?.state;
    const rowIndex = state?.visibleRows?.findIndex((row) => row.task?.id === taskId) ?? -1;
    const wrapper = state?.wrapper;
    if (rowIndex < 0 || !(wrapper instanceof HTMLElement)) return null;

    const rowHeight = Math.max(1, state?.rowHeight ?? 48);
    wrapper.scrollTop = Math.max(0, rowIndex * rowHeight - rowHeight * 2);
    wrapper.dispatchEvent(new Event("scroll"));
    return (await this.waitFor(() => this.taskButton(view.containerEl, taskId))) ?? null;
  }

  private revealAllTasks(view: ProjectManagerProjectView): void {
    if (view.filter) view.filter.showArchived = true;
    if (view.subview?.state?.filter) view.subview.state.filter.showArchived = true;

    const expand = (tasks: ProjectTask[]): void => {
      for (const task of tasks) {
        task.collapsed = false;
        expand(task.subtasks ?? []);
      }
    };
    expand(view.project?.tasks ?? []);
  }

  private taskButton(container: HTMLElement, taskId: string): HTMLElement | undefined {
    const rows = container.querySelectorAll<HTMLElement>("[data-task-id]");
    for (const row of rows) {
      if (row.dataset.taskId !== taskId) continue;
      const button = row.querySelector<HTMLElement>(".pm-task-title-text");
      if (button) return button;
    }
    return undefined;
  }

  private async waitFor<T>(
    read: () => T | null | undefined | false,
    timeout = RENDER_TIMEOUT_MS
  ): Promise<T | null> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = read();
      if (result) return result;
      await new Promise<void>((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return null;
  }

  private async waitForRemoval(element: HTMLElement): Promise<void> {
    if (!element.isConnected) return;
    await new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (element.isConnected) return;
        observer.disconnect();
        resolve();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
}
