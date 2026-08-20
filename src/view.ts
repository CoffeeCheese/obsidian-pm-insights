import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { aggregateInsights } from "./domain/aggregate";
import { translations, type Translations } from "./i18n";
import type {
  InsightSettings,
  MemberInsight,
  PriorityRecord,
  ProjectRecord,
  RatioMetric,
  TaskInsight,
  WorkMetrics
} from "./model";
import type { ProjectManagerSnapshot } from "./adapters/project-manager";

export const INSIGHTS_VIEW_TYPE = "project-manager-insights-view";

export interface InsightsViewHost {
  settings: InsightSettings;
  readProjectManager(): Promise<ProjectManagerSnapshot>;
  reconcileProjectManager(): Promise<ProjectManagerSnapshot>;
  saveSettings(): Promise<void>;
  openTask(taskId: string, projectPath: string): Promise<void>;
  openProject(projectPath: string): Promise<void>;
}

type TaskPrioritySort = "none" | "high-to-low" | "low-to-high";

const TASK_PRIORITY_NONE = "";
const TASK_COLUMN_MIN_WIDTHS = [180, 120, 92, 80, 64, 64, 72] as const;
const TASK_COLUMN_GAP = 10;
const TASK_TABLE_INLINE_PADDING = 22;
const TASK_COLUMN_KEYBOARD_STEP = 12;

export class InsightsView extends ItemView {
  private selectedMemberKey: string | null = null;
  private memberQuery = "";
  private taskQuery = "";
  private taskProjectIds: Set<string> | null = null;
  private taskStatuses: Set<string> | null = null;
  private taskPriorities: Set<string> | null = null;
  private taskPrioritySort: TaskPrioritySort = "none";
  private dashboardEl: HTMLElement | null = null;
  private projectSummaryEl: HTMLElement | null = null;
  private taskColumnWidths: number[] | null = null;
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
    this.registerDomEvent(document, "pointerdown", (event) => {
      const path = event.composedPath();
      const openMenus = this.containerEl.querySelectorAll<HTMLDetailsElement>(
        ".pmi-project-picker[open], .pmi-task-filter-menu[open]"
      );
      for (const menu of openMenus) {
        if (!path.includes(menu)) menu.open = false;
      }
    });
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
    const chevron = summary.createSpan("pmi-project-chevron");
    setIcon(chevron, "chevron-down");

    picker.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !picker.open) return;
      picker.open = false;
      summary.focus();
      event.preventDefault();
      event.stopPropagation();
    });

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
        checkbox.addEventListener("change", () => {
          void (async () => {
            const selected = new Set(this.host.settings.selectedProjectIds);
            checkbox.checked ? selected.add(project.id) : selected.delete(project.id);
            this.host.settings.selectedProjectIds = [...selected];
            this.selectedMemberKey = null;
            await this.host.saveSettings();
            this.updateProjectSummary(t);
            this.renderDashboard(snapshot, t);
          })();
        });
      }
    };

    projectSearch.addEventListener("input", renderProjects);
    selectAll.addEventListener("click", (event) => {
      void (async () => {
        event.preventDefault();
        this.host.settings.selectedProjectIds = snapshot.projects.map((project) => project.id);
        this.selectedMemberKey = null;
        await this.host.saveSettings();
        this.updateProjectSummary(t);
        renderProjects();
        this.renderDashboard(snapshot, t);
      })();
    });
    clear.addEventListener("click", (event) => {
      void (async () => {
        event.preventDefault();
        this.host.settings.selectedProjectIds = [];
        this.selectedMemberKey = null;
        await this.host.saveSettings();
        this.updateProjectSummary(t);
        renderProjects();
        this.renderDashboard(snapshot, t);
      })();
    });
    renderProjects();

    const archived = controls.createEl("label", {
      cls: "pmi-statistics-toggle pmi-archived-toggle"
    });
    const archivedCheckbox = archived.createEl("input", { type: "checkbox" });
    archivedCheckbox.checked = this.host.settings.includeArchived;
    archived.createSpan({ text: t.includeArchived });
    archivedCheckbox.addEventListener("change", () => {
      void (async () => {
        this.host.settings.includeArchived = archivedCheckbox.checked;
        await this.host.saveSettings();
        this.renderDashboard(snapshot, t);
      })();
    });

    const parentTasks = controls.createEl("label", {
      cls: "pmi-statistics-toggle pmi-parent-task-toggle"
    });
    const parentTasksCheckbox = parentTasks.createEl("input", { type: "checkbox" });
    parentTasksCheckbox.checked = this.host.settings.countParentTasks;
    parentTasks.createSpan({ text: t.countParentTasks });
    parentTasksCheckbox.addEventListener("change", () => {
      void (async () => {
        this.host.settings.countParentTasks = parentTasksCheckbox.checked;
        this.taskQuery = "";
        this.taskProjectIds = null;
        this.taskStatuses = null;
        this.taskPriorities = null;
        await this.host.saveSettings();
        this.renderDashboard(snapshot, t);
      })();
    });

    const refresh = controls.createEl("button", {
      cls: "pmi-refresh clickable-icon",
      attr: { "aria-label": t.refresh }
    });
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", () => void this.reconcileAndRender());
  }

  private async reconcileAndRender(): Promise<void> {
    await this.host.reconcileProjectManager();
    await this.render();
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
      countParentTasks: this.host.settings.countParentTasks,
      aliases: this.host.settings.aliases,
      unassignedLabel: t.unassigned
    });

    this.renderTeamStrip(dashboard, insights.team, t);
    const quality = dashboard.createDiv("pmi-quality-strip");
    setIcon(quality.createSpan(), "scan-search");
    quality.createEl("strong", { text: `${t.qualityTitle}:` });
    quality.createSpan({
      text: this.host.settings.countParentTasks
        ? t.parentTaskQualitySummary(
            insights.quality.parentTaskCount,
            insights.quality.unestimatedCount,
            insights.quality.unassignedCount,
            insights.quality.excludedChildTaskCount
          )
        : t.qualitySummary(
            insights.quality.subtaskCount,
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
      const nextMemberKey = visibleMembers[0]?.key ?? null;
      if (nextMemberKey !== this.selectedMemberKey) {
        this.taskQuery = "";
        this.taskProjectIds = null;
        this.taskStatuses = null;
        this.taskPriorities = null;
      }
      this.selectedMemberKey = nextMemberKey;
    }

    this.renderMemberList(master, insights.members, visibleMembers, snapshot, t);
    const selected = insights.members.find((member) => member.key === this.selectedMemberKey);
    this.renderTaskDetail(detail, selected, snapshot.projects, snapshot.priorities, t);
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
      this.taskProjectIds = null;
      this.taskStatuses = null;
      this.taskPriorities = null;
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
    priorities: PriorityRecord[],
    t: Translations
  ): void {
    const header = root.createDiv("pmi-pane-header pmi-detail-header");
    const identity = header.createDiv("pmi-detail-identity");
    identity.createEl("h2", { text: member?.name ?? t.tasks });
    identity.createSpan({ text: member ? t.taskCount(member.tasks.length) : "0" });

    if (!member) {
      root.createDiv({ cls: "pmi-list-empty", text: t.noTasks });
      return;
    }

    this.renderMemberRatios(header, member, t);

    const projectOptions = [...new Map(member.tasks.map((task) => [task.projectId, task.projectTitle]))]
      .map(([value, label]) => ({
        value,
        label,
        count: member.tasks.filter((task) => task.projectId === value).length
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
    const statusOptions = [...new Set(member.tasks.map((task) => task.status))]
      .map((value) => ({
        value,
        label: value,
        count: member.tasks.filter((task) => task.status === value).length
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
    const priorityDefinitions = new Map(priorities.map((priority) => [priority.id, priority]));
    const memberPriorityKeys = new Set(
      member.tasks.map((task) => task.priority ?? TASK_PRIORITY_NONE)
    );
    const priorityOptions = [
      ...priorities
        .filter((priority) => memberPriorityKeys.has(priority.id))
        .map((priority) => ({
          value: priority.id,
          label: priority.label,
          color: priority.color,
          count: member.tasks.filter((task) => task.priority === priority.id).length
        })),
      ...[...memberPriorityKeys]
        .filter((value) => value !== TASK_PRIORITY_NONE && !priorityDefinitions.has(value))
        .sort((left, right) => left.localeCompare(right))
        .map((value) => ({
          value,
          label: value,
          color: "",
          count: member.tasks.filter((task) => task.priority === value).length
        })),
      ...(memberPriorityKeys.has(TASK_PRIORITY_NONE)
        ? [{
            value: TASK_PRIORITY_NONE,
            label: t.noPriority,
            color: "",
            count: member.tasks.filter((task) => task.priority === null).length
          }]
        : [])
    ];
    this.taskProjectIds = this.normalizeTaskFilter(this.taskProjectIds, projectOptions);
    this.taskStatuses = this.normalizeTaskFilter(this.taskStatuses, statusOptions);
    this.taskPriorities = this.normalizeTaskFilter(this.taskPriorities, priorityOptions);

    const filters = root.createDiv("pmi-task-filter-bar");
    const searchWrap = filters.createDiv("pmi-task-filter-search");
    setIcon(searchWrap.createSpan(), "search");
    const search = searchWrap.createEl("input", {
      type: "search",
      placeholder: t.taskSearch,
      cls: "pmi-pane-search"
    });
    search.value = this.taskQuery;
    const result = filters.createDiv({ cls: "pmi-task-filter-result", attr: { "aria-live": "polite" } });
    const reset = filters.createEl("button", {
      cls: "pmi-task-filter-reset",
      attr: { type: "button", title: t.resetFilters, "aria-label": t.resetFilters }
    });
    setIcon(reset, "rotate-ccw");
    reset.createSpan({ text: t.resetFilters });

    const renderRows = (): void => {
      this.taskQuery = search.value.normalize("NFKC").trim().toLocaleLowerCase();
      const tasks = member.tasks.filter((task) => {
        const matchesText =
          !this.taskQuery ||
          task.title.normalize("NFKC").toLocaleLowerCase().includes(this.taskQuery) ||
          task.projectTitle.normalize("NFKC").toLocaleLowerCase().includes(this.taskQuery);
        const matchesProject =
          this.taskProjectIds === null || this.taskProjectIds.has(task.projectId);
        const matchesStatus = this.taskStatuses === null || this.taskStatuses.has(task.status);
        const matchesPriority =
          this.taskPriorities === null ||
          this.taskPriorities.has(task.priority ?? TASK_PRIORITY_NONE);
        return matchesText && matchesProject && matchesStatus && matchesPriority;
      });
      const priorityRanks = new Map(
        priorityOptions.map((priority, index) => [priority.value, index])
      );
      const sortedTasks = tasks
        .map((task, index) => ({ task, index }))
        .sort((left, right) => {
          if (this.taskPrioritySort === "none") return left.index - right.index;
          if (left.task.priority === null && right.task.priority !== null) return 1;
          if (left.task.priority !== null && right.task.priority === null) return -1;
          const leftRank =
            priorityRanks.get(left.task.priority ?? TASK_PRIORITY_NONE) ?? Number.MAX_SAFE_INTEGER;
          const rightRank =
            priorityRanks.get(right.task.priority ?? TASK_PRIORITY_NONE) ?? Number.MAX_SAFE_INTEGER;
          const rankDifference = leftRank - rightRank;
          if (rankDifference === 0) return left.index - right.index;
          return this.taskPrioritySort === "high-to-low" ? rankDifference : -rankDifference;
        })
        .map(({ task }) => task);
      result.setText(t.taskFilterResult(tasks.length, member.tasks.length));
      reset.disabled =
        this.taskQuery.length === 0 &&
        this.taskProjectIds === null &&
        this.taskStatuses === null &&
        this.taskPriorities === null;
      this.renderTaskRows(root, sortedTasks, projects, priorities, t, () => {
        this.taskPrioritySort =
          this.taskPrioritySort === "none"
            ? "high-to-low"
            : this.taskPrioritySort === "high-to-low"
              ? "low-to-high"
              : "none";
        renderRows();
      });
    };

    this.renderTaskFilterMenu(
      filters,
      "folder-kanban",
      t.project,
      t.allProjects,
      projectOptions,
      this.taskProjectIds,
      (selection) => {
        this.taskProjectIds = selection;
        renderRows();
      },
      t
    );
    this.renderTaskFilterMenu(
      filters,
      "workflow",
      t.status,
      t.allTaskStatuses,
      statusOptions,
      this.taskStatuses,
      (selection) => {
        this.taskStatuses = selection;
        renderRows();
      },
      t
    );
    this.renderTaskFilterMenu(
      filters,
      "signal-high",
      t.priority,
      t.allPriorities,
      priorityOptions,
      this.taskPriorities,
      (selection) => {
        this.taskPriorities = selection;
        renderRows();
      },
      t
    );
    search.addEventListener("input", renderRows);
    reset.addEventListener("click", () => {
      this.taskQuery = "";
      this.taskProjectIds = null;
      this.taskStatuses = null;
      this.taskPriorities = null;
      root.empty();
      this.renderTaskDetail(root, member, projects, priorities, t);
    });
    renderRows();
  }

  private renderMemberRatios(
    root: HTMLElement,
    member: MemberInsight,
    t: Translations
  ): void {
    const ledger = root.createDiv({
      cls: "pmi-member-ratios",
      attr: { role: "region", "aria-label": t.memberRatios }
    });
    const groups: Array<{
      kind: string;
      icon: string;
      label: string;
      metrics: Array<{
        label: string;
        hint: string;
        metric: RatioMetric;
        sample: (numerator: number, denominator: number) => string;
        warning?: boolean;
      }>;
    }> = [
      {
        kind: "delivery",
        icon: "circle-check-big",
        label: t.deliveryRatios,
        metrics: [
          {
            label: t.taskClosureRate,
            hint: t.taskClosureRateHint,
            metric: member.ratios.taskClosure,
            sample: t.ratioTasks
          },
          {
            label: t.plannedClosureRate,
            hint: t.plannedClosureRateHint,
            metric: member.ratios.plannedClosure,
            sample: t.ratioHours
          }
        ]
      },
      {
        kind: "time",
        icon: "timer",
        label: t.timeRatios,
        metrics: [
          {
            label: t.timeConsumptionRate,
            hint: t.timeConsumptionRateHint,
            metric: member.ratios.timeConsumption,
            sample: t.ratioHours
          },
          {
            label: t.overrunTaskRate,
            hint: t.overrunTaskRateHint,
            metric: member.ratios.overrunTasks,
            sample: t.ratioTasks,
            warning: member.ratios.overrunTasks.numerator > 0
          }
        ]
      },
      {
        kind: "data",
        icon: "scan-search",
        label: t.dataRatios,
        metrics: [
          {
            label: t.estimateAccuracyRate,
            hint: t.estimateAccuracyRateHint,
            metric: member.ratios.estimateAccuracy,
            sample: t.ratioTasks
          },
          {
            label: t.estimateCoverageRate,
            hint: t.estimateCoverageRateHint,
            metric: member.ratios.estimateCoverage,
            sample: t.ratioTasks
          }
        ]
      }
    ];

    for (const group of groups) {
      const row = ledger.createDiv(`pmi-ratio-group pmi-ratio-group--${group.kind}`);
      const heading = row.createDiv("pmi-ratio-group-label");
      setIcon(heading.createSpan(), group.icon);
      heading.createSpan({ text: group.label });
      for (const item of group.metrics) {
        const percentage =
          item.metric.percentage === null
            ? t.ratioUnavailable
            : t.percentage(item.metric.percentage);
        const sample = item.sample(item.metric.numerator, item.metric.denominator);
        const metric = row.createDiv({
          cls: `pmi-ratio-metric${item.warning ? " is-warning" : ""}`,
          attr: {
            title: item.hint,
            "aria-label": `${item.label}: ${percentage}; ${sample}. ${item.hint}`
          }
        });
        metric.createSpan({ cls: "pmi-ratio-name", text: item.label });
        metric.createEl("strong", { text: percentage });
      }
    }
  }

  private normalizeTaskFilter(
    selection: Set<string> | null,
    options: Array<{ value: string }>
  ): Set<string> | null {
    if (selection === null) return null;
    const available = new Set(options.map((option) => option.value));
    const normalized = new Set([...selection].filter((value) => available.has(value)));
    return normalized.size === available.size ? null : normalized;
  }

  private renderTaskFilterMenu(
    root: HTMLElement,
    icon: string,
    label: string,
    allLabel: string,
    options: Array<{ value: string; label: string; count: number; color?: string }>,
    selection: Set<string> | null,
    onChange: (selection: Set<string> | null) => void,
    t: Translations
  ): void {
    const menu = root.createEl("details", { cls: "pmi-task-filter-menu" });
    const summary = menu.createEl("summary", { attr: { "aria-label": label } });
    setIcon(summary.createSpan("pmi-task-filter-icon"), icon);
    const copy = summary.createSpan("pmi-task-filter-copy");
    copy.createSpan({ cls: "pmi-task-filter-label", text: label });
    const value = copy.createSpan("pmi-task-filter-value");
    const chevron = summary.createSpan("pmi-task-filter-chevron");
    setIcon(chevron, "chevron-down");

    const panel = menu.createDiv("pmi-task-filter-panel");
    const panelHead = panel.createDiv("pmi-task-filter-panel-head");
    panelHead.createEl("strong", { text: label });
    panelHead.createSpan({ text: t.optionCount(options.length) });
    const actions = panel.createDiv("pmi-task-filter-actions");
    const selectAll = actions.createEl("button", { text: t.selectAll, attr: { type: "button" } });
    const clear = actions.createEl("button", { text: t.clear, attr: { type: "button" } });
    const list = panel.createDiv("pmi-task-filter-options");
    let currentSelection = selection;

    const summaryText = (): string => {
      if (currentSelection === null || currentSelection.size === options.length) return allLabel;
      if (currentSelection.size === 0) return t.noneSelected;
      if (currentSelection.size === 1) {
        return options.find((option) => currentSelection?.has(option.value))?.label ?? t.selectedCount(1);
      }
      return t.selectedCount(currentSelection.size);
    };
    const update = (next: Set<string> | null): void => {
      currentSelection = next;
      value.setText(summaryText());
      for (const checkbox of list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
        checkbox.checked =
          currentSelection === null || currentSelection.has(checkbox.dataset.filterValue ?? "");
      }
      onChange(currentSelection);
    };

    for (const option of options) {
      const row = list.createEl("label", { cls: "pmi-task-filter-option" });
      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.dataset.filterValue = option.value;
      checkbox.checked = currentSelection === null || currentSelection.has(option.value);
      const name = row.createSpan("pmi-task-filter-option-name");
      if (option.color) {
        const signal = name.createSpan({ cls: "pmi-priority-signal", attr: { "aria-hidden": "true" } });
        signal.style.backgroundColor = option.color;
      }
      name.createSpan({ cls: "pmi-task-filter-option-label", text: option.label });
      row.createSpan({ cls: "pmi-task-filter-option-count", text: String(option.count) });
      checkbox.addEventListener("change", () => {
        const next =
          currentSelection === null
            ? new Set(options.map((candidate) => candidate.value))
            : new Set(currentSelection);
        checkbox.checked ? next.add(option.value) : next.delete(option.value);
        update(next.size === options.length ? null : next);
      });
    }

    value.setText(summaryText());
    selectAll.addEventListener("click", () => update(null));
    clear.addEventListener("click", () => update(new Set()));
    menu.addEventListener("toggle", () => {
      if (!menu.open) return;
      for (const sibling of root.querySelectorAll<HTMLDetailsElement>(
        ".pmi-task-filter-menu[open]"
      )) {
        if (sibling !== menu) sibling.open = false;
      }
    });
    menu.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !menu.open) return;
      menu.open = false;
      summary.focus();
      event.preventDefault();
      event.stopPropagation();
    });
  }

  private renderTaskRows(
    detail: HTMLElement,
    tasks: TaskInsight[],
    projects: ProjectRecord[],
    priorities: PriorityRecord[],
    t: Translations,
    onPrioritySort: (restoreFocus: boolean) => void
  ): void {
    detail.querySelector(".pmi-task-table")?.remove();
    detail.querySelector(".pmi-list-empty.pmi-task-empty")?.remove();
    if (tasks.length === 0) {
      detail.createDiv({ cls: "pmi-list-empty pmi-task-empty", text: t.noTasks });
      return;
    }

    const projectRecords = new Map(projects.map((project) => [project.id, project]));
    const table = detail.createDiv({
      cls: "pmi-task-table",
      attr: {
        role: "region",
        tabindex: "0",
        "aria-label": t.tasks
      }
    });
    if (this.taskColumnWidths) this.applyTaskColumnWidths(table, this.taskColumnWidths);

    const columns = table.createDiv("pmi-task-columns");
    const columnLabels = [
      t.tasks,
      t.project,
      t.priority,
      t.status,
      t.planned,
      t.logged,
      t.remaining
    ];
    const columnHeaders = columnLabels.map((label) => {
      const header = columns.createDiv({ cls: "pmi-task-column", attr: { role: "columnheader" } });
      if (label === t.priority) {
        header.setAttribute(
          "aria-sort",
          this.taskPrioritySort === "high-to-low"
            ? "descending"
            : this.taskPrioritySort === "low-to-high"
              ? "ascending"
              : "none"
        );
        const sortAccessibleLabel =
          this.taskPrioritySort === "none"
            ? t.sortPriority
            : `${t.priority}: ${
                this.taskPrioritySort === "high-to-low"
                  ? t.priorityHighToLow
                  : t.priorityLowToHigh
              }`;
        const sort = header.createEl("button", {
          cls: "pmi-task-sort",
          attr: { type: "button" }
        });
        sort.createSpan({
          cls: "pmi-task-sort-label",
          text: label,
          attr: { "aria-hidden": "true" }
        });
        sort.createSpan({ cls: "pmi-sr-only", text: sortAccessibleLabel });
        setIcon(
          sort.createSpan({ cls: "pmi-task-sort-icon", attr: { "aria-hidden": "true" } }),
          this.taskPrioritySort === "high-to-low"
            ? "chevron-down"
            : this.taskPrioritySort === "low-to-high"
              ? "chevron-up"
              : "chevrons-up-down"
        );
        sort.addEventListener("click", (event) => {
          const restoreFocus = event.detail === 0;
          onPrioritySort(restoreFocus);
          if (restoreFocus) detail.querySelector<HTMLElement>(".pmi-task-sort")?.focus();
        });
      } else {
        header.createSpan({ text: label });
      }
      return header;
    });
    columnHeaders.forEach((header, index) => {
      this.addTaskColumnResizer(table, columns, header, index, columnLabels[index] ?? "", t);
    });

    const priorityDefinitions = new Map(priorities.map((priority) => [priority.id, priority]));
    for (const task of tasks) {
      const projectRecord = projectRecords.get(task.projectId);
      const row = table.createDiv({
        cls: "pmi-task-row",
        attr: { role: "row" }
      });
      const title = row.createDiv({
        cls: "pmi-task-title pmi-task-open",
        attr: {
          role: "button",
          tabindex: "0",
          "aria-label": `${t.openTask}: ${task.title}`,
          title: t.openTask,
          "data-task-id": task.id
        }
      });
      title.createEl("strong", { text: task.title });
      const badges = title.createDiv("pmi-task-badges");
      if (task.assignmentKind === "shared") badges.createSpan({ text: t.shared });
      if (task.unestimated) badges.createSpan({ text: t.unestimated });
      if (task.archived) badges.createSpan({ text: t.archived });
      for (const tag of task.tags) {
        badges.createSpan({ cls: "pmi-task-tag", text: tag });
      }
      const project = row.createDiv({
        cls: "pmi-task-project pmi-project-open",
        attr: {
          role: "button",
          tabindex: "0",
          "aria-label": `${t.openProject}: ${task.projectTitle}`,
          title: t.openProject,
          "data-project-path": projectRecord?.path ?? ""
        }
      });
      project.createSpan({ text: projectRecord?.icon ?? "📋" });
      project.createSpan({ text: task.projectTitle });
      const priorityDefinition = task.priority ? priorityDefinitions.get(task.priority) : undefined;
      const priority = row.createDiv("pmi-task-priority");
      if (priorityDefinition?.color) {
        const signal = priority.createSpan({
          cls: "pmi-priority-signal",
          attr: { "aria-hidden": "true" }
        });
        signal.style.backgroundColor = priorityDefinition.color;
      }
      priority.createSpan({
        cls: `pmi-task-priority-label${task.priority ? "" : " is-empty"}`,
        text: priorityDefinition?.label ?? task.priority ?? t.noPriority
      });
      row.createSpan({ cls: "pmi-task-status", text: task.status });
      row.createSpan({ cls: "pmi-task-hours", text: t.hours(task.estimate) });
      row.createSpan({ cls: "pmi-task-hours", text: t.hours(task.logged) });
      row.createSpan({ cls: "pmi-task-hours pmi-task-remaining", text: t.hours(task.remaining) });
      this.bindCellAction(title, () => {
        if (!projectRecord) return;
        void this.host.openTask(task.id, projectRecord.path);
      });
      this.bindCellAction(project, () => {
        if (!projectRecord) return;
        void this.host.openProject(projectRecord.path);
      });
    }
  }

  private bindCellAction(element: HTMLElement, action: () => void): void {
    element.addEventListener("click", action);
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      action();
    });
  }

  private addTaskColumnResizer(
    table: HTMLElement,
    columns: HTMLElement,
    header: HTMLElement,
    index: number,
    label: string,
    t: Translations
  ): void {
    const minimumWidth = TASK_COLUMN_MIN_WIDTHS[index] ?? 64;
    const resizer = header.createDiv({
      cls: "pmi-task-column-resizer",
      attr: {
        role: "separator",
        tabindex: "0",
        "aria-label": t.resizeColumn(label),
        "aria-orientation": "vertical",
        "aria-valuemin": String(minimumWidth),
        title: t.resizeColumnHint(label)
      }
    });

    const currentWidths = (): number[] =>
      Array.from(columns.children, (column) => Math.round(column.getBoundingClientRect().width));

    const resize = (width: number): void => {
      const widths = this.taskColumnWidths ?? currentWidths();
      widths[index] = Math.max(minimumWidth, Math.round(width));
      this.taskColumnWidths = widths;
      this.applyTaskColumnWidths(table, widths);
      resizer.setAttribute("aria-valuenow", String(widths[index]));
    };

    resizer.setAttribute(
      "aria-valuenow",
      String(this.taskColumnWidths?.[index] ?? Math.round(header.getBoundingClientRect().width))
    );

    resizer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const widths = currentWidths();
      this.taskColumnWidths = widths;
      this.applyTaskColumnWidths(table, widths);
      const startX = event.clientX;
      const startWidth = widths[index] ?? minimumWidth;
      resizer.setPointerCapture(event.pointerId);
      resizer.addClass("is-resizing");
      table.addClass("is-resizing-columns");

      const onPointerMove = (moveEvent: PointerEvent): void => {
        resize(startWidth + moveEvent.clientX - startX);
      };
      const onPointerEnd = (endEvent: PointerEvent): void => {
        if (resizer.hasPointerCapture(endEvent.pointerId)) {
          resizer.releasePointerCapture(endEvent.pointerId);
        }
        resizer.removeClass("is-resizing");
        table.removeClass("is-resizing-columns");
        resizer.removeEventListener("pointermove", onPointerMove);
        resizer.removeEventListener("pointerup", onPointerEnd);
        resizer.removeEventListener("pointercancel", onPointerEnd);
      };
      resizer.addEventListener("pointermove", onPointerMove);
      resizer.addEventListener("pointerup", onPointerEnd);
      resizer.addEventListener("pointercancel", onPointerEnd);
    });

    resizer.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const widths = this.taskColumnWidths ?? currentWidths();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const step = event.shiftKey ? TASK_COLUMN_KEYBOARD_STEP * 4 : TASK_COLUMN_KEYBOARD_STEP;
      resize((widths[index] ?? minimumWidth) + direction * step);
    });

    resizer.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.taskColumnWidths = null;
      table.style.removeProperty("--pmi-task-grid-columns");
      table.style.removeProperty("--pmi-task-grid-min-width");
      const headers = columns.querySelectorAll<HTMLElement>(".pmi-task-column-resizer");
      headers.forEach((handle) => {
        const column = handle.parentElement;
        if (column) handle.setAttribute("aria-valuenow", String(Math.round(column.getBoundingClientRect().width)));
      });
    });
  }

  private applyTaskColumnWidths(table: HTMLElement, widths: readonly number[]): void {
    const gridWidth =
      widths.reduce((total, width) => total + width, 0) +
      TASK_COLUMN_GAP * (widths.length - 1) +
      TASK_TABLE_INLINE_PADDING;
    table.style.setProperty("--pmi-task-grid-columns", widths.map((width) => `${width}px`).join(" "));
    table.style.setProperty("--pmi-task-grid-min-width", `${gridWidth}px`);
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
