import { Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import { ProjectManagerCatalog, type ProjectManagerSnapshot } from "./adapters/project-manager";
import { ObsidianProjectManagerSource } from "./adapters/project-manager-source";
import {
  ProjectManagerNavigationError,
  ProjectManagerNavigator
} from "./adapters/project-manager-navigation";
import { translations } from "./i18n";
import {
  DEFAULT_SETTINGS,
  type DeliveryProgressSettings,
  type DeliveryStageId,
  type InsightSettings
} from "./model";
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
  private catalog!: ProjectManagerCatalog;
  private navigator!: ProjectManagerNavigator;
  private toolbarIntegration!: ProjectManagerToolbarIntegration;
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
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<InsightSettings> | null;
    const deliveryProgress = this.deliveryProgressSettings(saved?.deliveryProgress);
    this.settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...saved,
      aliases: Array.isArray(saved?.aliases) ? saved.aliases : [],
      selectedProjectIds: Array.isArray(saved?.selectedProjectIds) ? saved.selectedProjectIds : [],
      deliveryProgress
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
    } catch (error) {
      const t = translations(this.settings);
      const unsupported =
        error instanceof ProjectManagerNavigationError && error.code === "unsupported-version";
      new Notice(unsupported ? t.projectManagerVersionUnsupported : t.taskEditorUnavailable);
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

  private deliveryProgressSettings(
    saved: Partial<DeliveryProgressSettings> | undefined
  ): DeliveryProgressSettings {
    const defaults = structuredClone(DEFAULT_SETTINGS.deliveryProgress);
    const stageIds: DeliveryStageId[] = ["design", "development", "testing"];
    for (const stageId of stageIds) {
      const candidate = saved?.stages?.[stageId];
      if (!candidate) continue;
      defaults.stages[stageId] = {
        ...defaults.stages[stageId],
        ...candidate,
        tags: Array.isArray(candidate.tags)
          ? candidate.tags.filter((tag): tag is string => typeof tag === "string")
          : defaults.stages[stageId].tags,
        weight: typeof candidate.weight === "number" && Number.isFinite(candidate.weight)
          ? candidate.weight
          : defaults.stages[stageId].weight,
        acceptancePrerequisite: typeof candidate.acceptancePrerequisite === "boolean"
          ? candidate.acceptancePrerequisite
          : defaults.stages[stageId].acceptancePrerequisite,
        skipWhenEmpty: typeof candidate.skipWhenEmpty === "boolean"
          ? candidate.skipWhenEmpty
          : defaults.stages[stageId].skipWhenEmpty
      };
    }
    if (typeof saved?.acceptanceWeight === "number" && Number.isFinite(saved.acceptanceWeight)) {
      defaults.acceptanceWeight = saved.acceptanceWeight;
    }
    return defaults;
  }
}
