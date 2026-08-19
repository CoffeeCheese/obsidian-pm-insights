import { Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import { ProjectManagerAdapter, type ProjectManagerSnapshot } from "./adapters/project-manager";
import {
  ProjectManagerNavigationError,
  ProjectManagerNavigator
} from "./adapters/project-manager-navigation";
import { translations } from "./i18n";
import { DEFAULT_SETTINGS, type InsightSettings } from "./model";
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
  private adapter!: ProjectManagerAdapter;
  private navigator!: ProjectManagerNavigator;
  private toolbarIntegration!: ProjectManagerToolbarIntegration;
  private refreshTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.adapter = new ProjectManagerAdapter(this.app);
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
      callback: () => void this.refreshInsights()
    });
    this.addSettingTab(new InsightsSettingTab(this.app, this));

    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
    this.app.workspace.onLayoutReady(() => this.toolbarIntegration.start());
  }

  onunload(): void {
    this.toolbarIntegration.stop();
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<InsightSettings> | null;
    this.settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...saved,
      aliases: Array.isArray(saved?.aliases) ? saved.aliases : [],
      selectedProjectIds: Array.isArray(saved?.selectedProjectIds) ? saved.selectedProjectIds : []
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async readProjectManager(): Promise<ProjectManagerSnapshot> {
    return this.adapter.read();
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
    const views = this.app.workspace
      .getLeavesOfType(INSIGHTS_VIEW_TYPE)
      .map((leaf) => leaf.view)
      .filter((view): view is InsightsView => view instanceof InsightsView);
    await Promise.all(views.map((view) => view.refresh()));
    this.toolbarIntegration.sync();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshInsights();
    }, 250);
  }
}
