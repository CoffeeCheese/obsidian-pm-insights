import type { App, WorkspaceLeaf } from "obsidian";

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

    const originalLeaf = this.app.workspace.getLeaf(false);
    let temporaryLeaf: WorkspaceLeaf | null = null;

    try {
      const plugin = this.plugin();
      if (!COMPATIBLE_VERSION.test(plugin.manifest?.version ?? "")) {
        throw new ProjectManagerNavigationError("unsupported-version");
      }

      const existingModals = new Set(document.querySelectorAll(".modal-container"));
      temporaryLeaf = this.app.workspace.getLeaf("tab");
      await temporaryLeaf.setViewState({
        type: PROJECT_VIEW_TYPE,
        state: { filePath: target.projectPath },
        active: false
      });

      const projectView = temporaryLeaf.view as unknown as ProjectManagerProjectView;
      const taskButton = await this.findTaskButton(projectView, target.taskId);
      if (!taskButton) throw new ProjectManagerNavigationError("task-not-found");

      // The Project Manager view only exists to expose its native editor. Put
      // Insights back underneath the app-level modal before invoking it.
      this.restoreLeaf(originalLeaf);
      taskButton.click();
      const modal = await this.waitFor(() =>
        [...document.querySelectorAll<HTMLElement>(".modal-container")].find(
          (candidate) => !existingModals.has(candidate)
        )
      );
      if (!modal) throw new ProjectManagerNavigationError("task-editor-unavailable");
    } finally {
      temporaryLeaf?.detach();
      this.restoreLeaf(originalLeaf);
      this.openingTask = false;
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

  private restoreLeaf(leaf: WorkspaceLeaf | null): void {
    if (!leaf) return;
    this.app.workspace.setActiveLeaf(leaf, { focus: false });
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
}
