import { SettingsWriter } from "./settings-writer";
import { decideProjectLaunch, type LaunchCommand, type LaunchContext, type LaunchDecision } from "./domain/project-launch";
import { reconcileProjectGateActuals } from "./domain/gate-delay";
import { Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import { ProjectManagerCatalog, type ProjectManagerSnapshot } from "./adapters/project-manager";
import { ObsidianProjectManagerSource } from "./adapters/project-manager-source";
import { ProjectManagerNavigator } from "./adapters/project-manager-navigation";
import { ConfirmActionModal } from "./confirm-action-modal";
import { translations } from "./i18n";
import { DEFAULT_SETTINGS, type InsightSettings } from "./model";
import {
  openProjectManagerCommunityPage,
  projectManagerDependencyState
} from "./project-manager-dependency";
import { normalizeInsightSettings } from "./settings-data";
import { InsightsSettingTab } from "./settings";
import {
  ProjectManagerToolbarIntegration,
  type ToolbarIntegrationHost
} from "./toolbar-integration";
import { INSIGHTS_VIEW_TYPE, InsightsView } from "./view";

export default class ProjectManagerInsightsPlugin
  extends Plugin
  implements ToolbarIntegrationHost
{
  settings: InsightSettings = structuredClone(DEFAULT_SETTINGS);
  private readonly settingsWriter = new SettingsWriter({
    read: () => this.settings,
    write: (settings) => this.saveData(settings),
    publish: (settings) => { this.settings = settings; }
  });
  private catalog!: ProjectManagerCatalog;
  private navigator!: ProjectManagerNavigator;
  private toolbarIntegration!: ProjectManagerToolbarIntegration;
  private dependencyModal: ConfirmActionModal | null = null;
  private refreshTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.catalog = new ProjectManagerCatalog(new ObsidianProjectManagerSource(this.app));
    this.navigator = new ProjectManagerNavigator(this.app);
    this.toolbarIntegration = new ProjectManagerToolbarIntegration(this.app, this);

    this.registerView(INSIGHTS_VIEW_TYPE, (leaf) => new InsightsView(leaf, this));
    this.addRibbonIcon("chart-no-axes-combined", translations(this.settings).viewName, () => {
      void this.openInsights();
    });
    this.addCommand({
      id: "open-assignee-workload-insights",
      name: translations(this.settings).commandOpen,
      callback: () => void this.openInsights()
    });
    this.addCommand({
      id: "refresh-assignee-workload-insights",
      name: translations(this.settings).commandRefresh,
      callback: () => void this.reconcileInsights()
    });
    this.addSettingTab(new InsightsSettingTab(this.app, this));

    this.register(this.catalog.subscribe(() => this.scheduleRefresh()));
    this.app.workspace.onLayoutReady(() => this.toolbarIntegration.start());
  }

  onunload(): void {
    this.toolbarIntegration.stop();
    this.dependencyModal?.close();
    this.dependencyModal = null;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<InsightSettings> | null;
    this.settings = normalizeInsightSettings(saved);
  }

  async saveSettings(update?: (draft: InsightSettings) => void): Promise<void> {
    // No-argument form remains available for existing developer scripts.
    await this.settingsWriter.transact(update ?? (() => undefined), !update);
  }

  launchContext(projectId: string, snapshot: ProjectManagerSnapshot, settings = this.settings): LaunchContext {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return {
      projectId, tasks: snapshot.tasks, settings: settings.deliveryProgress,
      includeArchived: settings.includeArchived, schedule: settings.gateSchedules[projectId],
      actuals: settings.gateActuals[projectId], delay: settings.gateDelays[projectId],
      today, now: now.toISOString()
    };
  }

  async applyProjectLaunch(projectId: string, command: LaunchCommand): Promise<LaunchDecision> {
    const result = await this.settingsWriter.transact(async (draft) => {
      const snapshot = await this.reconcileProjectManager();
      if (!snapshot.projects.some((project) => project.id === projectId)) {
        return { kind: "rejected", reason: "schedule-invalid" } as const;
      }
      const decision = decideProjectLaunch(this.launchContext(projectId, snapshot, draft), command);
      if (decision.kind === "changed") {
        draft.gateActuals[projectId] = decision.next.actuals;
        if (decision.next.delay) draft.gateDelays[projectId] = decision.next.delay;
        else delete draft.gateDelays[projectId];
      }
      return decision;
    });
    if (result.kind === "changed") {
      // The save has succeeded; a view refresh failure must not invite a second write.
      try { await this.refreshInsights(); }
      catch { new Notice(translations(this.settings).launchRefreshFailed); }
    }
    return result;
  }

  async reconcileGateActuals(): Promise<void> {
    await this.settingsWriter.transact(async (draft) => {
      const snapshot = await this.readProjectManager();
      for (const project of snapshot.projects) {
        const context = this.launchContext(project.id, snapshot, draft);
        const result = reconcileProjectGateActuals({ ...context, previous: context.actuals });
        if (result.changed) draft.gateActuals[project.id] = result.state;
      }
    });
  }

  async readProjectManager(): Promise<ProjectManagerSnapshot> {
    return this.catalog.snapshot();
  }

  async reconcileProjectManager(): Promise<ProjectManagerSnapshot> {
    const snapshot = await this.catalog.reconcile();
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    return snapshot;
  }

  tooltip(): string {
    return translations(this.settings).toolbarTooltip;
  }

  async openProjectInsights(projectPath: string): Promise<void> {
    await this.openInsights(projectPath);
  }

  async openInsights(projectPath?: string): Promise<void> {
    this.promptForProjectManager();

    let leaf: WorkspaceLeaf;
    const existing = this.app.workspace.getLeavesOfType(INSIGHTS_VIEW_TYPE)[0];
    if (existing) {
      leaf = existing;
    } else {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: INSIGHTS_VIEW_TYPE, active: true });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (projectPath && leaf.view instanceof InsightsView) {
      await leaf.view.scopeToProjectPath(projectPath);
    }
  }

  openSettings(): void {
    const commands = Reflect.get(this.app, "commands") as unknown;
    if (!commands || typeof commands !== "object") return;
    const executeCommandById = Reflect.get(commands, "executeCommandById") as unknown;
    if (typeof executeCommandById !== "function") return;
    executeCommandById.call(commands, "app:open-settings");
    window.setTimeout(() => {
      const setting = Reflect.get(this.app, "setting") as unknown;
      if (!setting || typeof setting !== "object") return;
      const openTabById = Reflect.get(setting, "openTabById") as unknown;
      if (typeof openTabById === "function") {
        openTabById.call(setting, this.manifest.id);
      }
    }, 0);
  }

  async openTask(taskId: string, projectPath: string): Promise<void> {
    try {
      await this.navigator.editTask({ taskId, projectPath });
    } catch {
      new Notice(translations(this.settings).taskEditorUnavailable);
    }
  }

  async openProject(projectPath: string): Promise<void> {
    try {
      await this.navigator.openProject(projectPath);
    } catch {
      new Notice(translations(this.settings).projectManagerUnavailable);
    }
  }

  async refreshInsights(): Promise<void> {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    const views = this.app.workspace
      .getLeavesOfType(INSIGHTS_VIEW_TYPE)
      .map((leaf) => leaf.view)
      .filter((view): view is InsightsView => view instanceof InsightsView);
    await Promise.all(views.map((view) => view.refresh()));
    this.toolbarIntegration.sync();
  }

  private async reconcileInsights(): Promise<void> {
    await this.reconcileProjectManager();
    await this.refreshInsights();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshInsights();
    }, 250);
  }

  private promptForProjectManager(): void {
    const state = projectManagerDependencyState(this.app);
    if (state === "ready" || state === "unknown") {
      this.dependencyModal?.close();
      this.dependencyModal = null;
      return;
    }
    if (this.dependencyModal) return;

    const t = translations(this.settings);
    const modal = new ConfirmActionModal(this.app, {
      title: state === "missing"
        ? t.projectManagerDependencyMissingTitle
        : t.projectManagerDependencyDisabledTitle,
      message: state === "missing"
        ? t.projectManagerDependencyMissingBody
        : t.projectManagerDependencyDisabledBody,
      cancel: t.projectManagerDependencyLater,
      confirm: t.projectManagerDependencyOpen,
      onConfirm: () => {
        if (this.dependencyModal === modal) this.dependencyModal = null;
        openProjectManagerCommunityPage();
      },
      onCancel: () => {
        if (this.dependencyModal === modal) this.dependencyModal = null;
      }
    });
    this.dependencyModal = modal;
    modal.open();
  }

}
