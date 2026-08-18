import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { aggregateInsights } from "./domain/aggregate";
import { translations, type Translations } from "./i18n";
import type {
  InsightSettings,
  MemberInsight,
  ProjectRecord,
  TaskInsight,
  WorkMetrics
} from "./model";
import type { ProjectManagerSnapshot } from "./adapters/project-manager";

export const INSIGHTS_VIEW_TYPE = "project-manager-insights-view";

export interface InsightsViewHost {
  settings: InsightSettings;
  readProjectManager(): Promise<ProjectManagerSnapshot>;
  saveSettings(): Promise<void>;
  openTask(path: string, event: MouseEvent): Promise<void>;
}

type TaskFilter = "all" | "open" | "completed";

export class InsightsView extends ItemView {
  private selectedMemberKey: string | null = null;
  private memberQuery = "";
  private taskQuery = "";
  private taskFilter: TaskFilter = "all";
  private dashboardEl: HTMLElement | null = null;
  private projectSummaryEl: HTMLElement | null = null;
  private renderVersion = 0;

  constructor(leaf: WorkspaceLeaf, private readonly host: InsightsViewHost) {
    super(leaf);
    this.navigation = true;
  }

  getViewType(): string {
    return INSIGHTS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return translations(this.host.settings).viewName;
  }

  getIcon(): string {
    return "chart-no-axes-combined";
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass("pmi-view");
    await this.render();
  }

  async refresh(): Promise<void> {
    await this.render();
  }

  async scopeToProjectPath(path: string): Promise<void> {
    const snapshot = await this.host.readProjectManager();
    const project = snapshot.projects.find((candidate) => candidate.path === path);
    if (!project) return;
    this.host.settings.selectedProjectIds = [project.id];
    this.selectedMemberKey = null;
    await this.host.saveSettings();
    await this.render();
    this.contentEl.scrollTo({ top: 0 });
  }

  private async render(): Promise<void> {
    const version = ++this.renderVersion;
    const snapshot = await this.host.readProjectManager();
    if (version !== this.renderVersion) return;

    const t = translations(this.host.settings);
    const root = this.contentEl;
    root.empty();
    root.addClass("pmi-root");
    this.renderHeader(root, t);

    if (snapshot.projects.length === 0) {
      this.renderEmpty(root, t.noDataTitle, t.noDataBody, "folder-search-2");
      return;
    }

    const projectIds = new Set(snapshot.projects.map((project) => project.id));
    const validSelection = this.host.settings.selectedProjectIds.filter((id) => projectIds.has(id));
    if (validSelection.length !== this.host.settings.selectedProjectIds.length) {
      this.host.settings.selectedProjectIds = validSelection;
      await this.host.saveSettings();
    }

    this.renderControls(root, snapshot, t);
    this.dashboardEl = root.createDiv("pmi-dashboard");
    this.renderDashboard(snapshot, t);
  }

  private renderHeader(root: HTMLElement, t: Translations): void {
    const header = root.createDiv("pmi-header");
    const copy = header.createDiv("pmi-header-copy");
    copy.createDiv({ cls: "pmi-eyebrow", text: t.eyebrow });
    copy.createEl("h1", { text: t.heading });
    copy.createEl("p", { text: t.intro });
    const stamp = header.createDiv("pmi-snapshot-stamp");
    setIcon(stamp.createSpan("pmi-snapshot-icon"), "scan-line");
    stamp.createSpan({ text: new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date()) });
  }

  private renderControls(
    root: HTMLElement,
    snapshot: ProjectManagerSnapshot,
    t: Translations
  ): void {
    const controls = root.createDiv("pmi-controls");
    const picker = controls.createEl("details", { cls: "pmi-project-picker" });
    const summary = picker.createEl("summary");
    setIcon(summary.createSpan(), "layers-3");
    summary.createSpan({ cls: "pmi-control-label", text: t.projects });
    this.projectSummaryEl = summary.createSpan("pmi-project-count");
    this.updateProjectSummary(t);

    const panel = picker.createDiv("pmi-project-panel");
    const projectSearch = panel.createEl("input", {
      type: "search",
      placeholder: t.projectSearch,
      cls: "pmi-project-search"
    });
    const actions = panel.createDiv("pmi-project-actions");
    const selectAll = actions.createEl("button", { text: t.selectAll });
    const clear = actions.createEl("button", { text: t.clear });
    const list = panel.createDiv("pmi-project-list");

    const renderProjects = (): void => {
      const query = projectSearch.value.normalize("NFKC").trim().toLocaleLowerCase();
      list.empty();
      for (const project of snapshot.projects) {
        if (query && !project.title.normalize("NFKC").toLocaleLowerCase().includes(query)) continue;
        const row = list.createEl("label", { cls: "pmi-project-option" });
        const checkbox = row.createEl("input", { type: "checkbox" });
        checkbox.checked = this.host.settings.selectedProjectIds.includes(project.id);
        row.createSpan({ cls: "pmi-project-icon", text: project.icon });
        row.createSpan({ text: project.title });
        checkbox.addEventListener("change", async () => {
          const selected = new Set(this.host.settings.selectedProjectIds);
          checkbox.checked ? selected.add(project.id) : selected.delete(project.id);
          this.host.settings.selectedProjectIds = [...selected];
          this.selectedMemberKey = null;
          await this.host.saveSettings();
          this.updateProjectSummary(t);
          this.renderDashboard(snapshot, t);
        });
      }
    };

    projectSearch.addEventListener("input", renderProjects);
    selectAll.addEventListener("click", async (event) => {
      event.preventDefault();
      this.host.settings.selectedProjectIds = snapshot.projects.map((project) => project.id);
      this.selectedMemberKey = null;
      await this.host.saveSettings();
      this.updateProjectSummary(t);
      renderProjects();
      this.renderDashboard(snapshot, t);
    });
    clear.addEventListener("click", async (event) => {
      event.preventDefault();
      this.host.settings.selectedProjectIds = [];
      this.selectedMemberKey = null;
      await this.host.saveSettings();
      this.updateProjectSummary(t);
      renderProjects();
      this.renderDashboard(snapshot, t);
    });
    renderProjects();

    const archived = controls.createEl("label", { cls: "pmi-archived-toggle" });
    const archivedCheckbox = archived.createEl("input", { type: "checkbox" });
    archivedCheckbox.checked = this.host.settings.includeArchived;
    archived.createSpan({ text: t.includeArchived });
    archivedCheckbox.addEventListener("change", async () => {
      this.host.settings.includeArchived = archivedCheckbox.checked;
      await this.host.saveSettings();
      this.renderDashboard(snapshot, t);
    });

    const refresh = controls.createEl("button", {
      cls: "pmi-refresh clickable-icon",
      attr: { "aria-label": t.refresh }
    });
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", () => void this.render());
  }

  private updateProjectSummary(t: Translations): void {
    this.projectSummaryEl?.setText(t.projectCount(this.host.settings.selectedProjectIds.length));
  }

  private renderDashboard(snapshot: ProjectManagerSnapshot, t: Translations): void {
    const dashboard = this.dashboardEl;
    if (!dashboard) return;
    dashboard.empty();

    const selectedIds = new Set(this.host.settings.selectedProjectIds);
    if (selectedIds.size === 0) {
      this.renderEmpty(dashboard, t.noProjectsTitle, t.noProjectsBody, "list-filter");
      return;
    }

    const insights = aggregateInsights(snapshot.projects, snapshot.tasks, {
      projectIds: selectedIds,
      includeArchived: this.host.settings.includeArchived,
      aliases: this.host.settings.aliases,
      unassignedLabel: t.unassigned
    });

    this.renderTeamStrip(dashboard, insights.team, t);
    const quality = dashboard.createDiv("pmi-quality-strip");
    setIcon(quality.createSpan(), "scan-search");
    quality.createEl("strong", { text: `${t.qualityTitle}:` });
    quality.createSpan({
      text: t.qualitySummary(
        insights.quality.unestimatedCount,
        insights.quality.unassignedCount,
        insights.quality.excludedParentCount
      )
    });

    const layout = dashboard.createDiv("pmi-master-detail");
    const master = layout.createDiv("pmi-master");
    const detail = layout.createDiv("pmi-detail");

    const visibleMembers = insights.members.filter((member) =>
      member.name.normalize("NFKC").toLocaleLowerCase().includes(this.memberQuery)
    );
    if (!visibleMembers.some((member) => member.key === this.selectedMemberKey)) {
      this.selectedMemberKey = visibleMembers[0]?.key ?? null;
    }

    this.renderMemberList(master, insights.members, visibleMembers, snapshot, t);
    const selected = insights.members.find((member) => member.key === this.selectedMemberKey);
    this.renderTaskDetail(detail, selected, snapshot.projects, t);
  }

  private renderTeamStrip(root: HTMLElement, metrics: WorkMetrics, t: Translations): void {
    const strip = root.createDiv("pmi-team-strip");
    this.metric(strip, t.planned, t.hours(metrics.planned));
    this.metric(strip, t.logged, t.hours(metrics.logged));
    this.metric(strip, t.remaining, t.hours(metrics.remaining), "remaining");
    this.metric(strip, t.overrun, t.hours(metrics.overrun), metrics.overrun > 0 ? "overrun" : "");
  }

  private metric(root: HTMLElement, label: string, value: string, kind = ""): void {
    const item = root.createDiv(`pmi-metric${kind ? ` pmi-metric--${kind}` : ""}`);
    item.createSpan({ cls: "pmi-metric-label", text: label });
    item.createEl("strong", { text: value });
  }

  private renderMemberList(
    root: HTMLElement,
    allMembers: MemberInsight[],
    members: MemberInsight[],
    snapshot: ProjectManagerSnapshot,
    t: Translations
  ): void {
    const header = root.createDiv("pmi-pane-header");
    header.createEl("h2", { text: t.members });
    header.createSpan({ text: String(allMembers.length) });
    const search = root.createEl("input", {
      type: "search",
      placeholder: t.memberSearch,
      cls: "pmi-pane-search"
    });
    search.value = this.memberQuery;
    search.addEventListener("input", () => {
      this.memberQuery = search.value.normalize("NFKC").trim().toLocaleLowerCase();
      this.renderDashboard(snapshot, t);
      const next = this.contentEl.querySelector<HTMLInputElement>(".pmi-master .pmi-pane-search");
      next?.focus();
      next?.setSelectionRange(next.value.length, next.value.length);
    });

    const list = root.createDiv("pmi-member-list");
    if (members.length === 0) {
      list.createDiv({ cls: "pmi-list-empty", text: t.noMembers });
      return;
    }
    for (const member of members) this.renderMember(list, member, snapshot, t);
  }

  private renderMember(
    root: HTMLElement,
    member: MemberInsight,
    snapshot: ProjectManagerSnapshot,
    t: Translations
  ): void {
    const active = member.key === this.selectedMemberKey;
    const button = root.createEl("button", {
      cls: `pmi-member${active ? " is-active" : ""}`,
      attr: { "aria-pressed": String(active) }
    });
    const head = button.createDiv("pmi-member-head");
    const avatar = head.createSpan({ cls: "pmi-member-avatar" });
    if (member.kind === "unassigned") setIcon(avatar, "user-round-x");
    else avatar.setText(Array.from(member.name).slice(0, 2).join(""));
    const identity = head.createDiv("pmi-member-identity");
    identity.createEl("strong", { text: member.name });
    identity.createSpan({ text: t.taskCount(member.tasks.length) });
    head.createEl("strong", {
      cls: "pmi-member-total",
      text: t.hours(member.personal.remaining + member.shared.remaining)
    });

    this.renderWorkRail(button, t.personal, member.personal, false, t);
    if (member.shared.taskCount > 0) this.renderWorkRail(button, t.shared, member.shared, true, t);
    button.addEventListener("click", () => {
      this.selectedMemberKey = member.key;
      this.taskQuery = "";
      this.taskFilter = "all";
      this.renderDashboard(snapshot, t);
    });
  }

  private renderWorkRail(
    root: HTMLElement,
    label: string,
    metrics: WorkMetrics,
    shared: boolean,
    t: Translations
  ): void {
    const row = root.createDiv(`pmi-work-row${shared ? " is-shared" : ""}`);
    const legend = row.createDiv("pmi-work-legend");
    legend.createSpan({ text: label });
    legend.createSpan({ text: `${t.hours(metrics.logged)} / ${t.hours(metrics.planned)}` });
    const rail = row.createDiv("pmi-work-rail");
    const plannedLogged = metrics.planned > 0 ? Math.min(metrics.logged, metrics.planned) : metrics.logged;
    const scale = Math.max(metrics.planned, plannedLogged + metrics.overrun, 1);
    const logged = rail.createSpan("pmi-work-logged");
    logged.style.width = `${Math.min((plannedLogged / scale) * 100, 100)}%`;
    const remaining = rail.createSpan("pmi-work-remaining");
    remaining.style.width = `${Math.min((metrics.remaining / scale) * 100, 100)}%`;
    if (metrics.overrun > 0) {
      const overrun = rail.createSpan("pmi-work-overrun");
      overrun.style.width = `${Math.min((metrics.overrun / scale) * 100, 100)}%`;
    }
  }

  private renderTaskDetail(
    root: HTMLElement,
    member: MemberInsight | undefined,
    projects: ProjectRecord[],
    t: Translations
  ): void {
    const header = root.createDiv("pmi-pane-header pmi-detail-header");
    header.createEl("h2", { text: member?.name ?? t.tasks });
    header.createSpan({ text: member ? t.taskCount(member.tasks.length) : "0" });

    if (!member) {
      root.createDiv({ cls: "pmi-list-empty", text: t.noTasks });
      return;
    }

    const filters = root.createDiv("pmi-task-filters");
    const search = filters.createEl("input", {
      type: "search",
      placeholder: t.taskSearch,
      cls: "pmi-pane-search"
    });
    search.value = this.taskQuery;
    const select = filters.createEl("select");
    select.createEl("option", { value: "all", text: t.allStatuses });
    select.createEl("option", { value: "open", text: t.openStatuses });
    select.createEl("option", { value: "completed", text: t.completedStatuses });
    select.value = this.taskFilter;

    const renderRows = (): void => {
      this.taskQuery = search.value.normalize("NFKC").trim().toLocaleLowerCase();
      this.taskFilter = select.value as TaskFilter;
      const tasks = member.tasks.filter((task) => {
        const matchesText =
          !this.taskQuery ||
          task.title.normalize("NFKC").toLocaleLowerCase().includes(this.taskQuery) ||
          task.projectTitle.normalize("NFKC").toLocaleLowerCase().includes(this.taskQuery);
        const matchesStatus =
          this.taskFilter === "all" ||
          (this.taskFilter === "completed" ? task.completed : !task.completed);
        return matchesText && matchesStatus;
      });
      this.renderTaskRows(root, tasks, projects, t);
    };

    search.addEventListener("input", renderRows);
    select.addEventListener("change", renderRows);
    renderRows();
  }

  private renderTaskRows(
    detail: HTMLElement,
    tasks: TaskInsight[],
    projects: ProjectRecord[],
    t: Translations
  ): void {
    detail.querySelector(".pmi-task-table")?.remove();
    detail.querySelector(".pmi-list-empty.pmi-task-empty")?.remove();
    if (tasks.length === 0) {
      detail.createDiv({ cls: "pmi-list-empty pmi-task-empty", text: t.noTasks });
      return;
    }

    const projectIcons = new Map(projects.map((project) => [project.id, project.icon]));
    const table = detail.createDiv("pmi-task-table");
    const columns = table.createDiv("pmi-task-columns");
    columns.createSpan({ text: t.tasks });
    columns.createSpan({ text: t.project });
    columns.createSpan({ text: t.status });
    columns.createSpan({ text: t.planned });
    columns.createSpan({ text: t.logged });
    columns.createSpan({ text: t.remaining });

    for (const task of tasks) {
      const row = table.createEl("button", {
        cls: "pmi-task-row",
        attr: { "aria-label": `${t.openTask}: ${task.title}` }
      });
      const title = row.createDiv("pmi-task-title");
      title.createEl("strong", { text: task.title });
      const badges = title.createDiv("pmi-task-badges");
      if (task.assignmentKind === "shared") badges.createSpan({ text: t.shared });
      if (task.unestimated) badges.createSpan({ text: t.unestimated });
      if (task.archived) badges.createSpan({ text: t.archived });
      const project = row.createDiv("pmi-task-project");
      project.createSpan({ text: projectIcons.get(task.projectId) ?? "📋" });
      project.createSpan({ text: task.projectTitle });
      row.createSpan({ cls: "pmi-task-status", text: task.status });
      row.createSpan({ cls: "pmi-task-hours", text: t.hours(task.estimate) });
      row.createSpan({ cls: "pmi-task-hours", text: t.hours(task.logged) });
      row.createSpan({ cls: "pmi-task-hours pmi-task-remaining", text: t.hours(task.remaining) });
      row.addEventListener("click", (event) => void this.host.openTask(task.path, event));
    }
  }

  private renderEmpty(
    root: HTMLElement,
    title: string,
    body: string,
    icon: string
  ): void {
    const empty = root.createDiv("pmi-empty");
    setIcon(empty.createSpan("pmi-empty-icon"), icon);
    empty.createEl("h2", { text: title });
    empty.createEl("p", { text: body });
  }
}
