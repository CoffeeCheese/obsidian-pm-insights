import { ItemView, Modal, setIcon, type App, type WorkspaceLeaf } from "obsidian";
import { aggregateInsights } from "./domain/aggregate";
import {
  aggregateDeliveryProgress,
  type DeliveryProgressSnapshot,
  type StageProgressMetric
} from "./domain/delivery-progress";
import {
  compareAcceptanceSchedule,
  compareStageSchedule,
  type DeliveryScheduleComparison
} from "./domain/delivery-schedule";
import { translations, type Translations } from "./i18n";
import { DeliveryIssuesModal } from "./delivery-issues-modal";
import { validateGateSchedule } from "./domain/gate-schedule";
import { aggregateGateRisk, gateRiskSummaryState, type GateRiskSnapshot } from "./domain/gate-risk";
import { reconcileProjectGateActuals } from "./domain/gate-delay";
import { GateRiskModal } from "./gate-risk-modal";
import { ProjectGatesModal } from "./project-gates-modal";
import { deliveryStageLabel } from "./delivery-stage-label";
import { scheduleDaysBetween } from "./domain/schedule-calendar";
import {
  aggregateMemberDashboard,
  memberDashboardTaskKey,
  type MemberDashboardComparison,
  type MemberDashboardDriver,
  type MemberDashboardHealth,
  type MemberDashboardMetric,
  type MemberDashboardSnapshot
} from "./domain/member-dashboard";
import type {
  DeliveryStageId,
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
  refreshInsights(): Promise<void>;
  openSettings(): void;
  openTask(taskId: string, projectPath: string): Promise<void>;
  openProject(projectPath: string): Promise<void>;
}

type TaskPrioritySort = "none" | "high-to-low" | "low-to-high";

const TASK_PRIORITY_NONE = "";
const TASK_COLUMN_MIN_WIDTHS = [180, 120, 92, 80, 64, 64, 72] as const;
const TASK_COLUMN_GAP = 10;
const TASK_TABLE_INLINE_PADDING = 22;
const TASK_COLUMN_KEYBOARD_STEP = 12;
let nextDeliveryProgressLabelId = 0;
let nextMemberDashboardLabelId = 0;

interface MemberDashboardDrawerOptions {
  ariaLabel: string;
  render(root: HTMLElement): MemberDashboardHealth;
  onClose(): void;
}

class MemberDashboardDrawer extends Modal {
  constructor(
    app: App,
    private readonly options: MemberDashboardDrawerOptions
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("pmi-member-dashboard-modal");
    this.modalEl.setAttribute("aria-label", this.options.ariaLabel);
    this.contentEl.addClass("pmi-root");
    this.contentEl.addClass("pmi-member-dashboard-drawer-content");
    this.refresh();
  }

  refresh(): void {
    this.contentEl.empty();
    const health = this.options.render(this.contentEl);
    for (const state of ["normal", "attention", "high", "overdue"] as const) {
      this.modalEl.removeClass(`is-${state}`);
    }
    this.modalEl.addClass(`is-${health}`);
  }

  onClose(): void {
    this.contentEl.empty();
    this.options.onClose();
  }
}

export class InsightsView extends ItemView {
  private selectedMemberKey: string | null = null;
  private memberQuery = "";
  private taskQuery = "";
  private taskProjectIds: Set<string> | null = null;
  private taskStatuses: Set<string> | null = null;
  private taskPriorities: Set<string> | null = null;
  private taskPrioritySort: TaskPrioritySort = "none";
  private memberDashboardModal: MemberDashboardDrawer | null = null;
  private memberDashboardOpenMemberKey: string | null = null;
  private dashboardTaskKeys: Set<string> | null = null;
  private dashboardFilterId: string | null = null;
  private dashboardFilterLabel = "";
  private dashboardEl: HTMLElement | null = null;
  private projectSummaryEl: HTMLElement | null = null;
  private projectScopeEl: HTMLElement | null = null;
  private taskColumnWidths: number[] | null = null;
  private renderVersion = 0;
  private readonly deliveryProgressLabelId =
    `pmi-delivery-progress-label-${++nextDeliveryProgressLabelId}`;
  private readonly memberDashboardLabelId =
    `pmi-member-dashboard-${++nextMemberDashboardLabelId}`;

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

  async onClose(): Promise<void> {
    this.memberDashboardModal?.close();
    this.memberDashboardModal = null;
    this.memberDashboardOpenMemberKey = null;
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

    await this.reconcileGateActualStates(snapshot);

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
    const tools = header.createDiv("pmi-header-tools");
    const stamp = tools.createDiv("pmi-snapshot-stamp");
    setIcon(stamp.createSpan("pmi-snapshot-icon"), "scan-line");
    stamp.createSpan({ text: new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date()) });
    const settings = tools.createEl("button", {
      cls: "pmi-header-settings clickable-icon",
      attr: {
        type: "button",
        "aria-label": t.openSettings,
        "data-tooltip-position": "top"
      }
    });
    setIcon(settings, "settings-2");
    settings.addEventListener("click", () => this.host.openSettings());
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
        checkbox.dataset.projectId = project.id;
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
            this.updateProjectScope(snapshot, t);
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
        this.updateProjectScope(snapshot, t);
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
        this.updateProjectScope(snapshot, t);
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
        this.clearDashboardTaskFilter();
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

    this.projectScopeEl = root.createDiv({
      cls: "pmi-project-scope",
      attr: { "aria-live": "polite", "aria-atomic": "true" }
    });
    this.updateProjectScope(snapshot, t);
  }

  private async reconcileAndRender(): Promise<void> {
    await this.host.reconcileProjectManager();
    await this.render();
  }

  private updateProjectSummary(t: Translations): void {
    this.projectSummaryEl?.setText(t.projectCount(this.host.settings.selectedProjectIds.length));
  }

  private updateProjectScope(snapshot: ProjectManagerSnapshot, t: Translations): void {
    const scope = this.projectScopeEl;
    if (!scope) return;

    scope.empty();
    const selectedIds = new Set(this.host.settings.selectedProjectIds);
    const selectedProjects = snapshot.projects.filter((project) => selectedIds.has(project.id));
    scope.toggleClass("is-empty", selectedProjects.length === 0);

    const lead = scope.createDiv("pmi-project-scope-lead");
    const signal = lead.createSpan("pmi-project-scope-signal");
    setIcon(signal, "focus");
    const copy = lead.createDiv("pmi-project-scope-copy");
    copy.createSpan({ cls: "pmi-project-scope-label", text: t.projectScopeLabel });
    copy.createSpan({
      cls: "pmi-project-scope-summary",
      text: t.projectScopeSummary(selectedProjects.length, snapshot.projects.length)
    });

    const track = scope.createDiv("pmi-project-scope-track");
    if (selectedProjects.length === 0) {
      setIcon(track.createSpan("pmi-project-scope-empty-icon"), "circle-dashed");
      track.createSpan({ cls: "pmi-project-scope-empty", text: t.projectScopeEmpty });
      return;
    }

    for (const project of selectedProjects) {
      const token = track.createDiv({
        cls: "pmi-project-scope-token",
        attr: { title: project.title, "data-project-id": project.id }
      });
      token.createSpan({ cls: "pmi-project-scope-project-icon", text: project.icon });
      token.createSpan({ cls: "pmi-project-scope-project-name", text: project.title });
      const gateValidation = validateGateSchedule(
        this.host.settings.gateSchedules[project.id],
        this.host.settings.deliveryProgress.stages.map((stage) => stage.id)
      );
      const delayPlan = this.host.settings.gateDelays[project.id];
      const gates = token.createEl("button", {
        cls: `pmi-project-scope-gates${gateValidation.valid ? " is-configured" : ""}${delayPlan?.revisions.length ? " has-delay" : ""}`,
        attr: {
          type: "button",
          "aria-label": t.configureProjectGates(project.title),
          title: gateValidation.valid ? t.gatesConfigured : t.gatesNotConfigured,
          "data-tooltip-position": "top"
        }
      });
      setIcon(gates, "calendar-range");
      if (delayPlan?.revisions.length) gates.createSpan("pmi-project-scope-delay-dot");
      gates.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openProjectGates(project, snapshot, t);
      });
      const remove = token.createEl("button", {
        cls: "pmi-project-scope-remove",
        attr: {
          type: "button",
          "aria-label": t.removeProjectFromScope(project.title),
          title: t.removeProjectFromScope(project.title),
          "data-tooltip-position": "top"
        }
      });
      setIcon(remove, "x");
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const preserveKeyboardFocus = event.detail === 0;
        const remainingProjects = selectedProjects.filter((candidate) => candidate.id !== project.id);
        const removedIndex = selectedProjects.findIndex((candidate) => candidate.id === project.id);
        const focusProjectId = remainingProjects[Math.min(removedIndex, remainingProjects.length - 1)]?.id;
        token.classList.add("is-removing");
        remove.disabled = true;
        void (async () => {
          this.host.settings.selectedProjectIds = this.host.settings.selectedProjectIds.filter(
            (id) => id !== project.id
          );
          this.selectedMemberKey = null;
          const removalDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? Promise.resolve()
            : new Promise<void>((resolve) => window.setTimeout(resolve, 100));
          await Promise.all([this.host.saveSettings(), removalDelay]);
          this.updateProjectSummary(t);
          for (const checkbox of this.contentEl.querySelectorAll<HTMLInputElement>(
            '.pmi-project-option input[type="checkbox"]'
          )) {
            if (checkbox.dataset.projectId === project.id) checkbox.checked = false;
          }
          this.updateProjectScope(snapshot, t);
          this.renderDashboard(snapshot, t);
          if (preserveKeyboardFocus) {
            const focusTarget = focusProjectId
              ? [...this.contentEl.querySelectorAll<HTMLElement>(".pmi-project-scope-token")]
                  .find((candidate) => candidate.dataset.projectId === focusProjectId)
                  ?.querySelector<HTMLButtonElement>(".pmi-project-scope-remove")
              : this.contentEl.querySelector<HTMLElement>(".pmi-project-picker > summary");
            focusTarget?.focus();
          }
        })();
      });
    }
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

    const deliveryProgress = aggregateDeliveryProgress(snapshot.tasks, {
      projectIds: selectedIds,
      includeArchived: this.host.settings.includeArchived,
      settings: this.host.settings.deliveryProgress
    });
    const gateRisk = this.calculateGateRisk(snapshot, selectedIds);
    const buildMemberDashboard = (
      currentGateRisk = this.calculateGateRisk(snapshot, selectedIds)
    ): MemberDashboardSnapshot => aggregateMemberDashboard(insights.members, {
      today: this.todayDate(),
      settings: this.host.settings.memberDashboard,
      workdayHours: this.host.settings.gateRisk.workdayHours,
      calendarDayHours: this.host.settings.gateRisk.calendarDayHours,
      gateRisk: currentGateRisk,
      allTasks: snapshot.tasks,
      highPriorityIds: new Set(snapshot.priorities.slice(0, 2).map((priority) => priority.id))
    });
    const memberDashboard = buildMemberDashboard(gateRisk);
    this.renderGateRiskSummary(dashboard, gateRisk, deliveryProgress, snapshot, t);
    this.renderTeamStrip(dashboard, insights.team, t);
    if (this.host.settings.showDeliveryProgress) {
      this.renderDeliveryProgress(dashboard, deliveryProgress, gateRisk, snapshot.projects, t);
    } else {
      this.renderDeliveryProgressCollapsed(dashboard, t);
    }
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
        this.dashboardTaskKeys = null;
        this.dashboardFilterId = null;
        this.dashboardFilterLabel = "";
      }
      this.selectedMemberKey = nextMemberKey;
    }

    this.renderMemberList(master, insights.members, visibleMembers, snapshot, t);
    const selected = insights.members.find((member) => member.key === this.selectedMemberKey);
    this.renderTaskDetail(detail, selected, snapshot, memberDashboard, buildMemberDashboard, t);
  }

  private openProjectGates(
    project: ProjectRecord,
    snapshot: ProjectManagerSnapshot,
    t: Translations
  ): void {
    new ProjectGatesModal(this.app, {
      project,
      stages: this.host.settings.deliveryProgress.stages,
      stageName: (stage) => this.deliveryStageLabel(stage.id, stage.name, t),
      schedule: this.host.settings.gateSchedules[project.id],
      delay: this.host.settings.gateDelays[project.id],
      actuals: this.host.settings.gateActuals[project.id],
      today: this.todayDate(),
      translations: t,
      save: async ({ schedule, delay, actuals }) => {
        this.host.settings.gateSchedules[project.id] = schedule;
        if (delay) this.host.settings.gateDelays[project.id] = delay;
        else delete this.host.settings.gateDelays[project.id];
        this.host.settings.gateActuals[project.id] = actuals;
        await this.host.saveSettings();
        this.updateProjectScope(snapshot, t);
        this.renderDashboard(snapshot, t);
        this.refreshMemberDashboardDrawer();
      }
    }).open();
  }

  private renderGateRiskSummary(
    root: HTMLElement,
    risk: GateRiskSnapshot,
    delivery: DeliveryProgressSnapshot,
    snapshot: ProjectManagerSnapshot,
    t: Translations
  ): void {
    const state = gateRiskSummaryState(risk.counts);
    const summary = root.createEl("button", {
      cls: `pmi-gate-risk-summary is-${state}`,
      attr: { type: "button", "aria-label": t.viewGateRisk }
    });
    const signal = summary.createSpan("pmi-gate-risk-summary-signal");
    setIcon(signal, state === "normal" ? "milestone" : "shield-alert");
    const copy = summary.createDiv("pmi-gate-risk-summary-copy");
    copy.createSpan({ cls: "pmi-gate-risk-summary-label", text: t.gateRisk });
    copy.createEl("strong", {
      text: t.gateRiskSummary(
        risk.counts.overdue,
        risk.counts.high,
        risk.counts.attention,
        risk.counts.unconfigured
      )
    });
    if (risk.nearestGate) {
      copy.createSpan({
        cls: "pmi-gate-risk-summary-nearest",
        text: t.nearestGate(
          risk.nearestGate.project.title,
          this.gateRiskName(risk.nearestGate.gate, t),
          risk.nearestGate.gate.daysRemaining,
          risk.nearestGate.gate.includeWeekends,
          risk.nearestGate.gate.state === "overdue"
            ? "overdue"
            : risk.nearestGate.gate.gateDate === risk.today
              ? "today"
              : "remaining"
        )
      });
    }
    const delayedProjects = risk.projects.filter((project) =>
      project.gates.some((gate) => gate.delayStatus === "evaluating" || gate.delayStatus === "confirmed")
    ).length;
    if (delayedProjects > 0) {
      copy.createSpan({
        cls: "pmi-gate-risk-summary-delay",
        text: t.gateDelayProjectCount(delayedProjects)
      });
    }
    const action = summary.createSpan("pmi-gate-risk-summary-action");
    action.createSpan({ text: t.viewGateRisk });
    setIcon(action.createSpan(), "chevron-right");
    summary.addEventListener("click", () => {
      new GateRiskModal(this.app, {
        snapshot: risk,
        checkTaskDueDates: this.host.settings.gateRisk.checkTaskDueDates,
        priorities: snapshot.priorities,
        translations: t,
        hasDeliveryIssues: delivery.quality.issues.length > 0,
        openTask: (taskId, projectPath) => this.host.openTask(taskId, projectPath),
        openDeliveryIssues: () => {
          new DeliveryIssuesModal(this.app, {
            issues: delivery.quality.issues,
            projects: snapshot.projects,
            translations: t,
            openTask: (taskId, projectPath) => this.host.openTask(taskId, projectPath)
          }).open();
        },
        configureProject: (project) => this.openProjectGates(project, snapshot, t),
        setTaskDueDateChecks: async (enabled) => {
          const previous = this.host.settings.gateRisk.checkTaskDueDates;
          this.host.settings.gateRisk.checkTaskDueDates = enabled;
          try {
            await this.host.saveSettings();
            await this.host.refreshInsights();
            return this.calculateGateRisk(snapshot);
          } catch (error) {
            this.host.settings.gateRisk.checkTaskDueDates = previous;
            try {
              await this.host.saveSettings();
              await this.host.refreshInsights();
            } catch {
              // Preserve the original update error shown by the modal.
            }
            throw error;
          }
        }
      }).open();
    });
  }

  private calculateGateRisk(
    snapshot: ProjectManagerSnapshot,
    projectIds = new Set(this.host.settings.selectedProjectIds)
  ): GateRiskSnapshot {
    return aggregateGateRisk(snapshot.projects, snapshot.tasks, {
      projectIds,
      includeArchived: this.host.settings.includeArchived,
      settings: this.host.settings.deliveryProgress,
      gateSchedules: this.host.settings.gateSchedules,
      gateDelays: this.host.settings.gateDelays,
      gateActuals: this.host.settings.gateActuals,
      checkTaskDueDates: this.host.settings.gateRisk.checkTaskDueDates,
      workdayHours: this.host.settings.gateRisk.workdayHours,
      calendarDayHours: this.host.settings.gateRisk.calendarDayHours,
      countParentTasks: this.host.settings.countParentTasks,
      aliases: this.host.settings.aliases,
      today: this.todayDate()
    });
  }

  private async reconcileGateActualStates(snapshot: ProjectManagerSnapshot): Promise<void> {
    let changed = false;
    const today = this.todayDate();
    const now = new Date().toISOString();
    for (const project of snapshot.projects) {
      const result = reconcileProjectGateActuals({
        projectId: project.id,
        tasks: snapshot.tasks,
        settings: this.host.settings.deliveryProgress,
        includeArchived: this.host.settings.includeArchived,
        schedule: this.host.settings.gateSchedules[project.id],
        previous: this.host.settings.gateActuals[project.id],
        today,
        now
      });
      if (!result.changed) continue;
      this.host.settings.gateActuals[project.id] = result.state;
      changed = true;
    }
    if (changed) await this.host.saveSettings();
  }

  private gateRiskName(gate: GateRiskSnapshot["projects"][number]["gates"][number], t: Translations): string {
    if (gate.kind === "acceptance") return t.acceptanceGateLabel;
    if (gate.kind === "launch") return t.launchGateLabel;
    return this.deliveryStageLabel(gate.id, gate.name, t);
  }

  private todayDate(): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private renderTeamStrip(root: HTMLElement, metrics: WorkMetrics, t: Translations): void {
    const strip = root.createDiv("pmi-team-strip");
    this.metric(strip, t.planned, t.hours(metrics.planned));
    this.metric(strip, t.logged, t.hours(metrics.logged));
    this.metric(strip, t.remaining, t.hours(metrics.remaining), "remaining");
    this.metric(strip, t.overrun, t.hours(metrics.overrun), metrics.overrun > 0 ? "overrun" : "");
  }

  private renderDeliveryProgress(
    root: HTMLElement,
    progress: DeliveryProgressSnapshot,
    gateRisk: GateRiskSnapshot,
    projects: ProjectRecord[],
    t: Translations
  ): void {
    const section = root.createDiv({
      cls: "pmi-delivery-progress",
      attr: { role: "region", "aria-labelledby": this.deliveryProgressLabelId }
    });
    this.renderTotalProgress(section, progress, t, this.deliveryProgressLabelId, () => {
      void this.setDeliveryProgressVisible(false);
    });

    const rails = section.createDiv("pmi-progress-rails");
    for (const [index, metric] of progress.stages.entries()) {
      this.renderStageProgress(
        rails,
        this.deliveryStageLabel(metric.id, metric.name, t),
        this.deliveryStageIcon(metric.id, index),
        metric,
        compareStageSchedule(metric, gateRisk),
        index,
        t
      );
    }
    this.renderAcceptanceProgress(
      rails,
      progress,
      compareAcceptanceSchedule(progress.acceptance, gateRisk),
      t
    );

    const issueCount = progress.quality.issues.length;
    if (issueCount > 0) {
      const quality = section.createEl("button", {
        cls: "pmi-delivery-progress-quality",
        attr: {
          type: "button",
          "aria-label": `${t.viewDeliveryIssues}: ${t.deliveryIssuesCount(issueCount)}`
        }
      });
      const signal = quality.createSpan("pmi-delivery-progress-quality-signal");
      setIcon(signal, "circle-alert");
      quality.createSpan({
        cls: "pmi-delivery-progress-quality-summary",
        text: t.deliveryProgressQuality(
          progress.quality.unclassifiedTaskCount,
          progress.quality.conflictingTaskCount,
          progress.quality.unlinkedTaskCount,
          progress.quality.missingPrerequisiteCount,
          progress.quality.prematureCompletionCount
        )
      });
      const action = quality.createSpan("pmi-delivery-progress-quality-action");
      action.createSpan({ text: t.viewDeliveryIssues });
      setIcon(action.createSpan(), "chevron-right");
      quality.addEventListener("click", () => {
        new DeliveryIssuesModal(this.app, {
          issues: progress.quality.issues,
          projects,
          translations: t,
          openTask: (taskId, projectPath) => this.host.openTask(taskId, projectPath)
        }).open();
      });
    }
  }

  private renderDeliveryProgressCollapsed(root: HTMLElement, t: Translations): void {
    const section = root.createDiv({
      cls: "pmi-delivery-progress-collapsed",
      attr: { role: "region", "aria-labelledby": this.deliveryProgressLabelId }
    });
    const status = section.createDiv("pmi-delivery-progress-collapsed-status");
    setIcon(status.createSpan(), "route");
    status.createSpan({
      text: t.deliveryProgressHidden,
      attr: { id: this.deliveryProgressLabelId }
    });
    const show = section.createEl("button", {
      cls: "pmi-delivery-progress-show",
      attr: { type: "button", "aria-label": t.showDeliveryProgress }
    });
    setIcon(show.createSpan(), "eye");
    show.createSpan({ text: t.showDeliveryProgressAction });
    show.addEventListener("click", () => {
      void this.setDeliveryProgressVisible(true);
    });
  }

  private async setDeliveryProgressVisible(visible: boolean): Promise<void> {
    if (this.host.settings.showDeliveryProgress === visible) return;
    this.host.settings.showDeliveryProgress = visible;
    await this.host.saveSettings();
    await this.host.refreshInsights();
  }

  private renderStageProgress(
    root: HTMLElement,
    label: string,
    icon: string,
    metric: StageProgressMetric,
    schedule: DeliveryScheduleComparison,
    index: number,
    t: Translations
  ): void {
    const row = root.createDiv("pmi-progress-row pmi-progress-row--stage");
    row.dataset.stageId = metric.id;
    row.style.setProperty("--pmi-progress-color", `var(--pmi-stage-${(index % 8) + 1})`);
    const heading = row.createDiv("pmi-progress-row-heading");
    const name = heading.createDiv("pmi-progress-name");
    setIcon(name.createSpan(), icon);
    name.createSpan({ cls: "pmi-progress-name-label", text: label });
    this.renderScheduleComparison(name, schedule, t);
    const value = metric.state === "skipped"
      ? t.skippedStatistics
      : metric.state === "missing"
        ? t.missingStageTasks
        : t.percentage(metric.percentage ?? 0);
    heading.createEl("strong", { text: value });

    const trackShell = row.createDiv("pmi-progress-track-shell");
    const track = trackShell.createDiv({
      cls: `pmi-progress-track pmi-progress-track--${metric.state}`,
      attr: metric.percentage === null
        ? { "aria-label": `${label}: ${value}` }
        : {
            role: "progressbar",
            "aria-label": label,
            "aria-valuemin": "0",
            "aria-valuemax": "100",
            "aria-valuenow": String(metric.percentage),
            "aria-valuetext": t.stageTaskProgress(metric.completed, metric.total)
          }
    });
    if (metric.state === "progress") {
      const fill = track.createDiv("pmi-progress-fill");
      fill.style.width = `${metric.percentage ?? 0}%`;
    }
    this.renderExpectedMarker(trackShell, schedule);
    const context = row.createDiv("pmi-progress-context");
    const caption = context.createDiv("pmi-progress-caption");
    caption.createSpan({
      text: metric.state === "progress"
        ? t.stageTaskProgress(metric.completed, metric.total)
        : t.noMappedStageTasks
    });
    this.renderProgressWeight(caption, metric.weight, t, metric.state === "skipped");
  }

  private deliveryStageLabel(
    stageId: DeliveryStageId,
    name: string,
    t: Translations
  ): string {
    return deliveryStageLabel(stageId, name, t);
  }

  private deliveryStageIcon(stageId: DeliveryStageId, index: number): string {
    if (stageId === "design") return "pencil-ruler";
    if (stageId === "development") return "code-2";
    if (stageId === "testing") return "flask-conical";
    return ["scan-search", "blocks", "git-branch", "shield-check", "package-check"][index % 5]
      ?? "milestone";
  }

  private renderAcceptanceProgress(
    root: HTMLElement,
    progress: DeliveryProgressSnapshot,
    schedule: DeliveryScheduleComparison,
    t: Translations
  ): void {
    const metric = progress.acceptance;
    const row = root.createDiv("pmi-progress-row pmi-progress-row--acceptance");
    const heading = row.createDiv("pmi-progress-row-heading");
    const name = heading.createDiv("pmi-progress-name");
    setIcon(name.createSpan(), "badge-check");
    name.createSpan({ cls: "pmi-progress-name-label", text: t.acceptanceProgress });
    this.renderScheduleComparison(name, schedule, t);
    heading.createEl("strong", {
      text: metric.percentage === null ? t.ratioUnavailable : t.percentage(metric.percentage)
    });
    const trackShell = row.createDiv("pmi-progress-track-shell");
    const track = trackShell.createDiv({
      cls: "pmi-progress-track pmi-progress-track--acceptance",
      attr: metric.percentage === null
        ? { "aria-label": `${t.acceptanceProgress}: ${t.noRootTasks}` }
        : {
            role: "progressbar",
            "aria-label": t.acceptanceProgress,
            "aria-valuemin": "0",
            "aria-valuemax": "100",
            "aria-valuenow": String(metric.percentage),
            "aria-valuetext": t.acceptanceTaskProgress(
              metric.accepted,
              metric.total,
              metric.pending
            )
          }
    });
    if (metric.total > 0) {
      const accepted = track.createDiv("pmi-progress-acceptance-complete");
      accepted.style.width = `${(metric.accepted / metric.total) * 100}%`;
      const pending = track.createDiv("pmi-progress-acceptance-pending");
      pending.style.width = `${(metric.pending / metric.total) * 100}%`;
    }
    this.renderExpectedMarker(trackShell, schedule);
    const context = row.createDiv("pmi-progress-context");
    const caption = context.createDiv("pmi-progress-caption");
    caption.createSpan({
      text: metric.total > 0
        ? t.acceptanceTaskProgress(metric.accepted, metric.total, metric.pending)
        : t.noRootTasks
    });
    this.renderProgressWeight(caption, metric.weight, t);
  }

  private renderExpectedMarker(
    root: HTMLElement,
    schedule: DeliveryScheduleComparison
  ): void {
    if (schedule.expectedPercentage === null) return;
    const marker = root.createSpan({
      cls: "pmi-progress-expected-marker",
      attr: { "aria-hidden": "true" }
    });
    marker.style.left = `${schedule.expectedPercentage}%`;
  }

  private renderScheduleComparison(
    root: HTMLElement,
    schedule: DeliveryScheduleComparison,
    t: Translations
  ): void {
    const hasComparison = schedule.expectedPercentage !== null && schedule.variance !== null;
    const varianceLabel = !hasComparison
      ? schedule.state === "unconfigured"
        ? t.progressVarianceNeedsGates(
            schedule.configuredProjectCount,
            schedule.relevantProjectCount
          )
        : t.progressVarianceUnavailable
      : schedule.state === "ahead"
        ? t.progressVarianceAhead(schedule.variance ?? 0)
        : schedule.state === "behind"
          ? t.progressVarianceBehind(Math.abs(schedule.variance ?? 0))
          : t.progressVarianceOnPlan;
    const accessibleLabel = hasComparison
      ? `${t.expectedProgress(schedule.expectedPercentage ?? 0)} · ${varianceLabel}`
      : varianceLabel;
    const comparison = root.createSpan({
      cls: `pmi-progress-schedule is-${schedule.state}`,
      attr: {
        "data-schedule-state": schedule.state,
        role: "note",
        tabindex: "0"
      }
    });
    comparison.createSpan({ cls: "pmi-sr-only", text: accessibleLabel });
    if (!hasComparison) {
      comparison.createSpan({
        cls: "pmi-progress-schedule-placeholder",
        text: "— / —",
        attr: { "aria-hidden": "true" }
      });
      comparison.createSpan({
        cls: "pmi-progress-schedule-tooltip is-message",
        text: accessibleLabel,
        attr: { "aria-hidden": "true" }
      });
      return;
    }

    const expectedValue = `${(schedule.expectedPercentage ?? 0).toLocaleString(undefined, {
      maximumFractionDigits: 1
    })}%`;
    const varianceValue = schedule.state === "ahead"
      ? `+${(schedule.variance ?? 0).toLocaleString(undefined, {
          maximumFractionDigits: 1
        })}%`
      : schedule.state === "behind"
        ? `−${Math.abs(schedule.variance ?? 0).toLocaleString(undefined, {
            maximumFractionDigits: 1
          })}%`
        : "±0%";
    comparison.createSpan({
      cls: "pmi-progress-expected-copy",
      text: expectedValue,
      attr: { "aria-hidden": "true" }
    });
    comparison.createSpan({
      cls: "pmi-progress-schedule-separator",
      text: "/",
      attr: { "aria-hidden": "true" }
    });
    comparison.createEl("strong", {
      cls: "pmi-progress-variance",
      text: varianceValue,
      attr: { "aria-hidden": "true" }
    });
    const tooltip = comparison.createSpan({
      cls: "pmi-progress-schedule-tooltip",
      attr: { "aria-hidden": "true" }
    });
    const expectedMetric = tooltip.createSpan("pmi-progress-schedule-tooltip-metric");
    expectedMetric.createSpan({
      cls: "pmi-progress-schedule-tooltip-label",
      text: t.expectedProgressLabel
    });
    expectedMetric.createEl("strong", { text: expectedValue });
    const varianceMetric = tooltip.createSpan("pmi-progress-schedule-tooltip-metric is-variance");
    varianceMetric.createSpan({
      cls: "pmi-progress-schedule-tooltip-label",
      text: t.progressVarianceLabel
    });
    varianceMetric.createEl("strong", { text: varianceValue });
  }

  private renderProgressWeight(
    root: HTMLElement,
    weight: number,
    t: Translations,
    inactive = false
  ): void {
    root.createSpan({
      cls: `pmi-progress-weight${inactive ? " pmi-progress-weight--inactive" : ""}`,
      text: `${t.stageWeight} ${t.percentage(weight)}`
    });
  }

  private renderTotalProgress(
    root: HTMLElement,
    progress: DeliveryProgressSnapshot,
    t: Translations,
    labelId: string,
    onHide: () => void
  ): void {
    const percentage = progress.totalPercentage;
    const row = root.createDiv("pmi-progress-row pmi-progress-row--total");
    const heading = row.createDiv("pmi-progress-row-heading");
    const name = heading.createDiv("pmi-progress-name");
    setIcon(name.createSpan(), "route");
    const label = name.createDiv("pmi-progress-overview-label");
    label.createSpan({ text: t.deliveryProgress, attr: { id: labelId } });
    label.createEl("small", { text: t.totalProgress });
    const actions = heading.createDiv("pmi-progress-heading-actions");
    actions.createEl("strong", {
      text: percentage === null ? t.ratioUnavailable : t.percentage(percentage)
    });
    const hide = actions.createEl("button", {
      cls: "clickable-icon pmi-delivery-progress-hide",
      attr: {
        type: "button",
        "aria-label": t.hideDeliveryProgress,
        "data-tooltip-position": "top"
      }
    });
    setIcon(hide, "eye-off");
    hide.addEventListener("click", onHide);
    const track = row.createDiv({
      cls: "pmi-progress-track pmi-progress-track--total",
      attr: percentage === null
        ? { "aria-label": `${t.totalProgress}: ${t.noRootTasks}` }
        : {
            role: "progressbar",
            "aria-label": t.totalProgress,
            "aria-valuemin": "0",
            "aria-valuemax": "100",
            "aria-valuenow": String(percentage),
            "aria-valuetext": t.percentage(percentage)
          }
    });
    if (percentage !== null) {
      const fill = track.createDiv("pmi-progress-fill");
      fill.style.width = `${percentage}%`;
    }
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
      this.dashboardTaskKeys = null;
      this.dashboardFilterId = null;
      this.dashboardFilterLabel = "";
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
    snapshot: ProjectManagerSnapshot,
    dashboard: MemberDashboardSnapshot,
    buildMemberDashboard: () => MemberDashboardSnapshot,
    t: Translations
  ): void {
    const projects = snapshot.projects;
    const priorities = snapshot.priorities;
    const header = root.createDiv("pmi-pane-header pmi-detail-header");
    const identity = header.createDiv("pmi-detail-identity");
    identity.createEl("h2", { text: member?.name ?? t.tasks });
    identity.createSpan({ text: member ? t.taskCount(member.tasks.length) : "0" });

    if (!member) {
      root.createDiv({ cls: "pmi-list-empty", text: t.noTasks });
      return;
    }

    const memberDashboard = dashboard.members.find((candidate) =>
      candidate.memberKey === member.key);
    if (memberDashboard) {
      const dashboardOpen = this.memberDashboardModal !== null
        && this.memberDashboardOpenMemberKey === member.key;
      const toggle = identity.createEl("button", {
        cls: `pmi-member-dashboard-toggle is-${memberDashboard.health}${dashboardOpen ? " is-active" : ""}`,
        attr: {
          type: "button",
          "aria-haspopup": "dialog",
          "aria-expanded": String(dashboardOpen),
          "aria-controls": this.memberDashboardLabelId,
          "aria-label": dashboardOpen
            ? t.closeMemberDashboard(member.name)
            : t.openMemberDashboard(member.name),
          title: `${dashboardOpen ? t.closeMemberDashboard(member.name) : t.openMemberDashboard(member.name)} · ${this.memberDashboardHealthLabel(memberDashboard.health, t)}`,
          "data-member-key": member.key,
          "data-tooltip-position": "top"
        }
      });
      setIcon(toggle.createSpan("pmi-member-dashboard-toggle-icon"), "gauge");
      toggle.createSpan({ cls: "pmi-member-dashboard-toggle-state", attr: { "aria-hidden": "true" } });
      toggle.addEventListener("click", () => {
        if (this.memberDashboardModal && this.memberDashboardOpenMemberKey === member.key) {
          this.memberDashboardModal.close();
          return;
        }
        this.openMemberDashboard(member, snapshot, buildMemberDashboard, t);
      });
    }

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
        const matchesDashboard = this.dashboardTaskKeys === null
          || this.dashboardTaskKeys.has(memberDashboardTaskKey(task));
        return matchesText && matchesProject && matchesStatus && matchesPriority
          && matchesDashboard;
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
      result.empty();
      result.createSpan({ text: t.taskFilterResult(tasks.length, member.tasks.length) });
      if (this.dashboardTaskKeys !== null) {
        const dashboardFilter = result.createEl("button", {
          cls: "pmi-dashboard-filter-chip",
          attr: {
            type: "button",
            title: t.clearDashboardFilter,
            "aria-label": `${t.clearDashboardFilter}: ${this.dashboardFilterLabel}`
          }
        });
        dashboardFilter.createSpan({ text: this.dashboardFilterLabel });
        setIcon(dashboardFilter.createSpan(), "x");
        dashboardFilter.addEventListener("click", () => {
          this.clearDashboardTaskFilter();
          this.renderDashboard(snapshot, t);
        });
      }
      reset.disabled =
        this.taskQuery.length === 0 &&
        this.taskProjectIds === null &&
        this.taskStatuses === null &&
        this.taskPriorities === null &&
        this.dashboardTaskKeys === null;
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
      this.dashboardTaskKeys = null;
      this.dashboardFilterId = null;
      this.dashboardFilterLabel = "";
      root.empty();
      this.renderTaskDetail(root, member, snapshot, dashboard, buildMemberDashboard, t);
    });
    renderRows();
  }

  private openMemberDashboard(
    member: MemberInsight,
    snapshot: ProjectManagerSnapshot,
    buildMemberDashboard: () => MemberDashboardSnapshot,
    t: Translations
  ): void {
    this.memberDashboardModal?.close();
    let drawer: MemberDashboardDrawer;
    drawer = new MemberDashboardDrawer(this.app, {
      ariaLabel: t.openMemberDashboard(member.name),
      render: (root) => {
        const dashboard = buildMemberDashboard();
        const metric = dashboard.members.find((candidate) => candidate.memberKey === member.key);
        if (!metric) {
          root.createDiv({ cls: "pmi-list-empty", text: t.noTasks });
          return "normal";
        }
        this.renderMemberDashboard(root, metric, dashboard, snapshot, t);
        return metric.health;
      },
      onClose: () => {
        if (this.memberDashboardModal !== drawer) return;
        this.memberDashboardModal = null;
        this.memberDashboardOpenMemberKey = null;
        const toggle = [...this.contentEl.querySelectorAll<HTMLButtonElement>(
          ".pmi-member-dashboard-toggle"
        )].find((candidate) => candidate.dataset.memberKey === member.key);
        toggle?.removeClass("is-active");
        toggle?.setAttribute("aria-expanded", "false");
        toggle?.setAttribute("aria-label", t.openMemberDashboard(member.name));
        window.setTimeout(() => toggle?.focus(), 0);
      }
    });
    this.memberDashboardModal = drawer;
    this.memberDashboardOpenMemberKey = member.key;
    const toggle = [...this.contentEl.querySelectorAll<HTMLButtonElement>(
      ".pmi-member-dashboard-toggle"
    )].find((candidate) => candidate.dataset.memberKey === member.key);
    toggle?.addClass("is-active");
    toggle?.setAttribute("aria-expanded", "true");
    toggle?.setAttribute("aria-label", t.closeMemberDashboard(member.name));
    drawer.open();
  }

  private refreshMemberDashboardDrawer(focusSelector?: string): void {
    const drawer = this.memberDashboardModal;
    if (!drawer) return;
    drawer.refresh();
    if (!focusSelector) return;
    window.setTimeout(() => {
      drawer.contentEl.querySelector<HTMLElement>(focusSelector)?.focus();
    }, 0);
  }

  private renderMemberDashboard(
    root: HTMLElement,
    metric: MemberDashboardMetric,
    dashboard: MemberDashboardSnapshot,
    snapshot: ProjectManagerSnapshot,
    t: Translations
  ): void {
    const section = root.createDiv({
      cls: `pmi-member-dashboard is-${metric.health}`,
      attr: {
        id: this.memberDashboardLabelId,
        role: "region",
        "aria-label": t.memberDashboard,
        "data-member-key": metric.memberKey
      }
    });
    const mast = section.createDiv("pmi-member-dashboard-mast");
    const identity = mast.createDiv("pmi-member-dashboard-title");
    identity.createSpan({ cls: "pmi-member-dashboard-kicker", text: t.memberDashboard });
    identity.createEl("h2", { text: metric.memberName });
    identity.createEl("p", {
      text: t.deliveryRunwayWindow(
        dashboard.window.startDate,
        dashboard.window.endDate,
        dashboard.window.days,
        dashboard.window.includeWeekends
      )
    });
    const health = mast.createDiv("pmi-member-health");
    const healthSignal = health.createSpan("pmi-member-health-signal");
    setIcon(healthSignal, this.memberDashboardHealthIcon(metric.health));
    const healthCopy = health.createDiv("pmi-member-health-copy");
    healthCopy.createSpan({ cls: "pmi-member-dashboard-kicker", text: t.deliveryHealth });
    healthCopy.createEl("strong", {
      text: this.memberDashboardHealthLabel(metric.health, t)
    });

    this.renderMemberGateSetupNotice(section, metric, snapshot, t);

    const commandBar = section.createDiv("pmi-member-dashboard-commandbar");
    const drivers = commandBar.createDiv("pmi-member-health-drivers");
    const visibleDrivers = metric.drivers.slice(0, 3);
    if (visibleDrivers.length === 0) {
      drivers.createSpan({ cls: "pmi-member-health-clear", text: t.memberHealthClear });
    } else {
      for (const item of visibleDrivers) {
        const label = this.memberDashboardDriverLabel(item, metric, t);
        const id = `driver-${item.kind}`;
        const button = drivers.createEl("button", {
          cls: `pmi-member-health-driver is-${item.state}${this.dashboardFilterId === id ? " is-active" : ""}`,
          attr: {
            type: "button",
            "aria-pressed": String(this.dashboardFilterId === id),
            "data-dashboard-filter-id": id,
            title: t.filterTasksByInsight(label)
          }
        });
        button.createSpan({ text: label });
        setIcon(button.createSpan(), "arrow-down-to-line");
        button.addEventListener("click", () => {
          this.applyDashboardTaskFilter(id, label, item.taskKeys, snapshot, t);
        });
      }
    }
    this.renderMemberDashboardControls(commandBar, dashboard, snapshot, t);

    this.renderMemberRunway(section, metric, dashboard, snapshot, t);

    const instruments = section.createDiv("pmi-member-instruments");
    this.renderMemberProgressInstrument(instruments, metric, snapshot, t);
    this.renderMemberLoadInstrument(instruments, metric, snapshot, t);
    this.renderMemberComparison(instruments, metric, dashboard.comparison, t);

    this.renderMemberProjectMix(section, metric, dashboard, snapshot, t);
    const ledgerSection = section.createDiv("pmi-member-ledger-section");
    const ledgerHeading = ledgerSection.createDiv("pmi-member-section-heading");
    const ledgerTitle = ledgerHeading.createDiv();
    setIcon(ledgerTitle.createSpan(), "scan-line");
    ledgerTitle.createEl("strong", { text: t.memberRatios });
    ledgerHeading.createSpan({
      text: t.teamReferenceSample(dashboard.comparison.sampleSize),
      attr: { title: t.teamReferenceMethod(dashboard.comparison.sampleSize) }
    });
    this.renderMemberRatios(ledgerSection, metric.ratios, dashboard.comparison, t);
  }

  private renderMemberGateSetupNotice(
    root: HTMLElement,
    metric: MemberDashboardMetric,
    snapshot: ProjectManagerSnapshot,
    t: Translations
  ): void {
    const affectedIds = new Set(metric.unconfiguredProjectIds);
    const affectedProjects = snapshot.projects.filter((project) => affectedIds.has(project.id));
    if (affectedProjects.length === 0) return;

    const notice = root.createDiv({
      cls: "pmi-member-gate-notice",
      attr: { role: "status" }
    });
    const signal = notice.createSpan("pmi-member-gate-notice-signal");
    setIcon(signal, "calendar-warning");
    const copy = notice.createDiv("pmi-member-gate-notice-copy");
    copy.createEl("strong", { text: t.memberGateSetupTitle });
    copy.createEl("p", { text: t.memberGateSetupBody(affectedProjects.length) });
    const actions = notice.createDiv("pmi-member-gate-notice-actions");
    for (const project of affectedProjects) {
      const action = actions.createEl("button", {
        cls: "pmi-member-gate-notice-action",
        attr: {
          type: "button",
          "aria-label": t.configureProjectGates(project.title),
          title: t.configureProjectGates(project.title)
        }
      });
      action.createSpan({ cls: "pmi-member-gate-notice-project-icon", text: project.icon });
      action.createSpan({ cls: "pmi-member-gate-notice-project", text: project.title });
      action.createSpan({ cls: "pmi-member-gate-notice-action-label", text: t.memberGateSetupAction });
      setIcon(action.createSpan("pmi-member-gate-notice-chevron"), "chevron-right");
      action.addEventListener("click", () => this.openProjectGates(project, snapshot, t));
    }
  }

  private renderMemberDashboardControls(
    root: HTMLElement,
    dashboard: MemberDashboardSnapshot,
    snapshot: ProjectManagerSnapshot,
    t: Translations
  ): void {
    const controls = root.createDiv("pmi-member-dashboard-controls");
    const windows = controls.createDiv({
      cls: "pmi-member-window-options",
      attr: { role: "group", "aria-label": t.loadWindow }
    });
    for (const mode of ["7", "14", "30"] as const) {
      const active = this.host.settings.memberDashboard.windowMode === mode;
      const button = windows.createEl("button", {
        cls: `pmi-member-window-option${active ? " is-active" : ""}`,
        attr: {
          type: "button",
          "aria-pressed": String(active),
          "data-window-mode": mode,
          title: t.setLoadWindow(Number(mode))
        },
        text: t.compactDays(Number(mode))
      });
      button.addEventListener("click", () => {
        void this.updateMemberDashboardWindow(mode, snapshot, t);
      });
    }
    const custom = controls.createEl("label", {
      cls: `pmi-member-window-custom${this.host.settings.memberDashboard.windowMode === "custom" ? " is-active" : ""}`
    });
    custom.createSpan({ text: t.customWindow });
    const date = custom.createEl("input", {
      type: "date",
      attr: {
        min: dashboard.window.startDate,
        "data-window-mode": "custom",
        "aria-label": t.customWindowEnd
      }
    });
    date.value = this.host.settings.memberDashboard.windowMode === "custom"
        && this.host.settings.memberDashboard.customEndDate >= dashboard.window.startDate
      ? this.host.settings.memberDashboard.customEndDate
      : dashboard.window.endDate;
    date.addEventListener("change", () => {
      if (!date.value || date.value < dashboard.window.startDate) return;
      void this.updateMemberDashboardWindow("custom", snapshot, t, date.value);
    });
    const weekend = controls.createEl("label", { cls: "pmi-member-weekend-toggle" });
    const weekendInput = weekend.createEl("input", { type: "checkbox" });
    weekendInput.checked = dashboard.window.includeWeekends;
    weekend.createSpan({ text: t.includeWeekendsInCapacity });
    weekendInput.addEventListener("change", () => {
      void (async () => {
        this.host.settings.memberDashboard.includeWeekends = weekendInput.checked;
        this.clearDashboardTaskFilter();
        await this.host.saveSettings();
        this.renderDashboard(snapshot, t);
        this.refreshMemberDashboardDrawer(".pmi-member-weekend-toggle input");
      })();
    });
  }

  private async updateMemberDashboardWindow(
    mode: "7" | "14" | "30" | "custom",
    snapshot: ProjectManagerSnapshot,
    t: Translations,
    customEndDate?: string
  ): Promise<void> {
    this.host.settings.memberDashboard.windowMode = mode;
    if (mode === "custom" && customEndDate) {
      this.host.settings.memberDashboard.customEndDate = customEndDate;
    }
    this.clearDashboardTaskFilter();
    await this.host.saveSettings();
    this.renderDashboard(snapshot, t);
    this.refreshMemberDashboardDrawer(`[data-window-mode="${mode}"]`);
  }

  private renderMemberRunway(
    root: HTMLElement,
    metric: MemberDashboardMetric,
    dashboard: MemberDashboardSnapshot,
    snapshot: ProjectManagerSnapshot,
    t: Translations
  ): void {
    const runway = root.createDiv("pmi-member-runway");
    const heading = runway.createDiv("pmi-member-section-heading pmi-runway-heading");
    const title = heading.createDiv();
    setIcon(title.createSpan(), "milestone");
    const titleCopy = title.createDiv();
    titleCopy.createEl("strong", { text: t.deliveryRunway });
    titleCopy.createSpan({
      text: t.deliveryRunwayWindow(
        dashboard.window.startDate,
        dashboard.window.endDate,
        dashboard.window.days,
        dashboard.window.includeWeekends
      )
    });
    const outcome = heading.createDiv({
      cls: `pmi-runway-outcome${metric.balanceHours < 0 ? " is-gap" : " is-buffer"}`
    });
    outcome.createSpan({ text: metric.balanceHours < 0 ? t.capacityGap : t.capacityBuffer });
    outcome.createEl("strong", { text: t.hours(Math.abs(metric.balanceHours)) });

    const scroll = runway.createDiv("pmi-runway-scroll");
    const track = scroll.createDiv("pmi-runway-track");
    track.style.setProperty("--pmi-runway-min-width", `${Math.max(620, metric.checkpoints.length * 112)}px`);
    const rail = track.createDiv("pmi-runway-rail");
    rail.createSpan("pmi-runway-capacity-line");
    const start = track.createDiv("pmi-runway-boundary is-start");
    start.createSpan("pmi-runway-boundary-dot");
    start.createSpan({ text: t.today });
    const end = track.createDiv("pmi-runway-boundary is-end");
    setIcon(end.createSpan("pmi-runway-boundary-flag"), "flag");
    end.createSpan({ text: this.shortDate(dashboard.window.endDate) });

    if (metric.checkpoints.length === 0) {
      track.createDiv({ cls: "pmi-runway-empty", text: t.noWindowCommitments });
    }
    const totalCalendarDays = Math.max(1, scheduleDaysBetween(
      dashboard.window.startDate,
      dashboard.window.endDate,
      true
    ));
    for (const [index, checkpoint] of metric.checkpoints.entries()) {
      const elapsed = Math.max(0, scheduleDaysBetween(
        dashboard.window.startDate,
        checkpoint.date,
        true
      ));
      const position = Math.min(100, (elapsed / totalCalendarDays) * 100);
      const id = `checkpoint-${checkpoint.date}`;
      const label = t.checkpointFilterLabel(checkpoint.date, checkpoint.dueTaskCount);
      const point = track.createEl("button", {
        cls: `pmi-runway-checkpoint is-${checkpoint.state}${index % 2 === 1 ? " is-lower" : ""}${this.dashboardFilterId === id ? " is-active" : ""}`,
        attr: {
          type: "button",
          "aria-pressed": String(this.dashboardFilterId === id),
          "data-dashboard-filter-id": id,
          "aria-label": t.runwayCheckpointAria(
            checkpoint.date,
            checkpoint.dueTaskCount,
            checkpoint.remainingHours,
            checkpoint.availableHours,
            this.memberDashboardHealthLabel(checkpoint.state, t)
          )
        }
      });
      point.style.setProperty("--pmi-runway-position", `${position}%`);
      point.createSpan("pmi-runway-checkpoint-stem");
      point.createSpan("pmi-runway-checkpoint-dot");
      const copy = point.createSpan("pmi-runway-checkpoint-copy");
      copy.createSpan({ text: this.shortDate(checkpoint.date) });
      copy.createEl("strong", { text: t.capacityPair(checkpoint.remainingHours, checkpoint.availableHours) });
      point.addEventListener("click", () => {
        this.applyDashboardTaskFilter(id, label, checkpoint.taskKeys, snapshot, t);
      });
    }
    const runwayLegend = runway.createDiv("pmi-runway-legend");
    runwayLegend.createSpan({ text: t.runwayLegendCommitment });
    runwayLegend.createSpan({ text: t.runwayLegendCapacity });
    runwayLegend.createSpan({ text: t.runwayLegendNode });
  }

  private renderMemberProgressInstrument(
    root: HTMLElement,
    metric: MemberDashboardMetric,
    snapshot: ProjectManagerSnapshot,
    t: Translations
  ): void {
    const instrument = root.createEl("button", {
      cls: `pmi-member-instrument is-progress${this.dashboardFilterId === "window-progress" ? " is-active" : ""}`,
      attr: {
        type: "button",
        "aria-pressed": String(this.dashboardFilterId === "window-progress"),
        "data-dashboard-filter-id": "window-progress",
        title: t.filterWindowTasks
      }
    });
    const head = instrument.createDiv("pmi-member-instrument-head");
    setIcon(head.createSpan(), "route");
    head.createSpan({ text: t.windowProgress });
    const percentage = metric.windowRatios.plannedClosure.percentage;
    instrument.createEl("strong", {
      cls: "pmi-member-instrument-value",
      text: percentage === null ? t.ratioUnavailable : t.percentage(percentage)
    });
    instrument.createSpan({
      cls: "pmi-member-instrument-primary",
      text: t.plannedClosureDetail(
        metric.windowRatios.plannedClosure.numerator,
        metric.windowRatios.plannedClosure.denominator
      )
    });
    instrument.createSpan({
      cls: "pmi-member-instrument-secondary",
      text: t.taskClosureDetail(metric.completedTaskCount, metric.windowTaskCount)
    });
    instrument.addEventListener("click", () => {
      this.applyDashboardTaskFilter("window-progress", t.windowProgress, metric.windowTaskKeys, snapshot, t);
    });
  }

  private renderMemberLoadInstrument(
    root: HTMLElement,
    metric: MemberDashboardMetric,
    snapshot: ProjectManagerSnapshot,
    t: Translations
  ): void {
    const activeKeys = metric.tasks.filter((task) => task.inWindow && !task.task.completed)
      .map((task) => task.key);
    const loadState = metric.committedHours > metric.availableHours
      ? "high"
      : (metric.loadPercentage ?? 0) >= 80
        ? "attention"
        : "normal";
    const instrument = root.createEl("button", {
      cls: `pmi-member-instrument is-load is-${loadState}${this.dashboardFilterId === "window-load" ? " is-active" : ""}`,
      attr: {
        type: "button",
        "aria-pressed": String(this.dashboardFilterId === "window-load"),
        "data-dashboard-filter-id": "window-load",
        title: t.filterWindowLoad
      }
    });
    const head = instrument.createDiv("pmi-member-instrument-head");
    setIcon(head.createSpan(), "timer");
    head.createSpan({ text: t.plannedLoad });
    instrument.createEl("strong", {
      cls: "pmi-member-instrument-value",
      text: metric.loadPercentage === null ? t.ratioUnavailable : t.percentage(metric.loadPercentage)
    });
    instrument.createSpan({
      cls: "pmi-member-instrument-primary",
      text: t.capacityPair(metric.committedHours, metric.availableHours)
    });
    instrument.createSpan({
      cls: "pmi-member-instrument-secondary",
      text: t.remainingWorkContext(metric.allRemainingHours, metric.laterHours)
    });
    instrument.addEventListener("click", () => {
      this.applyDashboardTaskFilter("window-load", t.plannedLoad, activeKeys, snapshot, t);
    });
  }

  private renderMemberComparison(
    root: HTMLElement,
    metric: MemberDashboardMetric,
    comparison: MemberDashboardComparison,
    t: Translations
  ): void {
    const panel = root.createDiv("pmi-member-comparison");
    const heading = panel.createDiv("pmi-member-instrument-head");
    setIcon(heading.createSpan(), "users-round");
    heading.createSpan({ text: t.teamComparison });
    heading.createEl("small", {
      text: t.teamReferenceSample(comparison.sampleSize),
      attr: { title: t.teamReferenceMethod(comparison.sampleSize) }
    });
    const rows = [
      [t.plannedLoad, metric.loadPercentage, comparison.loadPercentage],
      [t.plannedClosureRate, metric.windowRatios.plannedClosure.percentage, comparison.plannedClosurePercentage],
      [t.overdueTasks, metric.overduePercentage, comparison.overduePercentage],
      [t.overrunTaskRate, metric.windowRatios.overrunTasks.percentage, comparison.overrunPercentage]
    ] as const;
    for (const [label, value, benchmark] of rows) {
      const row = panel.createDiv("pmi-member-comparison-row");
      const copy = row.createDiv("pmi-member-comparison-copy");
      copy.createSpan({ text: label });
      copy.createEl("strong", { text: value === null ? t.ratioUnavailable : t.percentage(value) });
      const track = row.createDiv({
        cls: "pmi-member-comparison-track",
        attr: { "aria-label": t.teamComparisonAria(label, value, benchmark, comparison.sampleSize) }
      });
      const scale = Math.max(100, value ?? 0, benchmark ?? 0);
      const fill = track.createSpan("pmi-member-comparison-fill");
      fill.style.width = `${Math.min(100, ((value ?? 0) / scale) * 100)}%`;
      if (benchmark !== null) {
        const marker = track.createSpan("pmi-member-comparison-marker");
        marker.style.left = `${Math.min(100, (benchmark / scale) * 100)}%`;
      }
    }
    const structure = panel.createDiv("pmi-member-comparison-structure");
    structure.createSpan({ text: t.projectSpreadComparison(metric.projectCount, comparison.projectCount) });
    structure.createSpan({ text: t.sharedWorkComparison(metric.sharedPercentage, comparison.sharedPercentage) });
    structure.createSpan({ text: t.highPriorityComparison(metric.highPriorityPercentage, comparison.highPriorityPercentage) });
  }

  private renderMemberProjectMix(
    root: HTMLElement,
    metric: MemberDashboardMetric,
    dashboard: MemberDashboardSnapshot,
    snapshot: ProjectManagerSnapshot,
    t: Translations
  ): void {
    const section = root.createDiv("pmi-member-project-mix");
    const heading = section.createDiv("pmi-member-section-heading");
    const title = heading.createDiv();
    setIcon(title.createSpan(), "layers-3");
    title.createEl("strong", { text: t.workComposition });
    heading.createSpan({ text: t.windowRemainingByProject });
    if (metric.projects.length === 0) {
      section.createDiv({ cls: "pmi-member-dashboard-empty", text: t.noEstimatedProjectLoad });
      return;
    }
    const tracks = section.createDiv("pmi-project-mix-tracks");
    this.renderProjectMixTrack(
      tracks,
      metric.projects,
      metric.memberName,
      true,
      dashboard.teamProjects
    );
    this.renderProjectMixTrack(
      tracks,
      dashboard.teamProjects,
      t.teamOverall,
      false,
      dashboard.teamProjects
    );
    const legend = section.createDiv("pmi-project-mix-legend");
    for (const [index, project] of metric.projects.entries()) {
      const team = dashboard.teamProjects.find((candidate) => candidate.projectId === project.projectId);
      const id = `project-${project.projectId}`;
      const label = t.projectMixFilterLabel(project.projectTitle);
      const colorIndex = dashboard.teamProjects.findIndex((candidate) =>
        candidate.projectId === project.projectId);
      const button = legend.createEl("button", {
        cls: `pmi-project-mix-item is-${((colorIndex < 0 ? index : colorIndex) % 8) + 1}${this.dashboardFilterId === id ? " is-active" : ""}`,
        attr: {
          type: "button",
          "aria-pressed": String(this.dashboardFilterId === id),
          "data-dashboard-filter-id": id,
          title: t.filterTasksByInsight(label)
        }
      });
      button.createSpan("pmi-project-mix-swatch");
      const copy = button.createSpan("pmi-project-mix-copy");
      copy.createEl("strong", { text: project.projectTitle });
      copy.createSpan({ text: t.projectMixComparison(project.percentage, team?.percentage ?? null, project.hours) });
      button.addEventListener("click", () => {
        this.applyDashboardTaskFilter(id, label, project.taskKeys, snapshot, t);
      });
    }
  }

  private renderProjectMixTrack(
    root: HTMLElement,
    projects: MemberDashboardMetric["projects"],
    label: string,
    interactive: boolean,
    colorProjects: MemberDashboardMetric["projects"]
  ): void {
    const row = root.createDiv("pmi-project-mix-track-row");
    row.createSpan({ text: label });
    const track = row.createDiv("pmi-project-mix-track");
    for (const project of projects) {
      const index = colorProjects.findIndex((candidate) =>
        candidate.projectId === project.projectId);
      const segment = track.createSpan({
        cls: `pmi-project-mix-segment is-${((Math.max(index, 0)) % 8) + 1}${interactive ? " is-personal" : ""}`,
        attr: { title: `${project.projectTitle}: ${project.percentage ?? 0}%`, "aria-hidden": "true" }
      });
      segment.style.width = `${project.percentage ?? 0}%`;
    }
  }

  private applyDashboardTaskFilter(
    id: string,
    label: string,
    taskKeys: string[],
    snapshot: ProjectManagerSnapshot,
    t: Translations
  ): void {
    if (this.dashboardFilterId === id) this.clearDashboardTaskFilter();
    else {
      this.dashboardFilterId = id;
      this.dashboardFilterLabel = label;
      this.dashboardTaskKeys = new Set(taskKeys);
    }
    this.memberDashboardModal?.close();
    this.renderDashboard(snapshot, t);
    window.setTimeout(() => {
      const focusTarget = this.dashboardTaskKeys === null
        ? this.contentEl.querySelector<HTMLElement>(".pmi-member-dashboard-toggle")
        : this.contentEl.querySelector<HTMLElement>(".pmi-dashboard-filter-chip");
      focusTarget?.focus();
    }, 0);
  }

  private clearDashboardTaskFilter(): void {
    this.dashboardTaskKeys = null;
    this.dashboardFilterId = null;
    this.dashboardFilterLabel = "";
  }

  private memberDashboardDriverLabel(
    driver: MemberDashboardDriver,
    metric: MemberDashboardMetric,
    t: Translations
  ): string {
    switch (driver.kind) {
      case "overdue": return t.memberDriverOverdue(driver.taskCount);
      case "capacity": return driver.hours > 0
        ? t.memberDriverCapacityGap(driver.hours)
        : t.memberDriverCapacityTight(metric.loadPercentage ?? 0);
      case "gate": return t.memberDriverGate(driver.taskCount);
      case "unestimated": return t.memberDriverUnestimated(driver.taskCount);
      case "unscheduled": return t.memberDriverUnscheduled(driver.taskCount);
      case "overrun": return t.memberDriverOverrun(driver.taskCount);
    }
  }

  private memberDashboardHealthLabel(health: MemberDashboardHealth, t: Translations): string {
    switch (health) {
      case "normal": return t.memberHealthNormal;
      case "attention": return t.memberHealthAttention;
      case "high": return t.memberHealthHigh;
      case "overdue": return t.memberHealthOverdue;
    }
  }

  private memberDashboardHealthIcon(health: MemberDashboardHealth): string {
    switch (health) {
      case "normal": return "circle-check-big";
      case "attention": return "circle-alert";
      case "high": return "shield-alert";
      case "overdue": return "clock-alert";
    }
  }

  private shortDate(date: string): string {
    const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
      .format(new Date(year, month - 1, day));
  }

  private renderMemberRatios(
    root: HTMLElement,
    ratios: MemberInsight["ratios"],
    comparison: MemberDashboardComparison,
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
        benchmark: number | null;
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
            metric: ratios.taskClosure,
            benchmark: comparison.ledgerTaskClosurePercentage,
            sample: t.ratioTasks
          },
          {
            label: t.plannedClosureRate,
            hint: t.plannedClosureRateHint,
            metric: ratios.plannedClosure,
            benchmark: comparison.ledgerPlannedClosurePercentage,
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
            metric: ratios.timeConsumption,
            benchmark: comparison.ledgerTimeConsumptionPercentage,
            sample: t.ratioHours
          },
          {
            label: t.overrunTaskRate,
            hint: t.overrunTaskRateHint,
            metric: ratios.overrunTasks,
            benchmark: comparison.ledgerOverrunPercentage,
            sample: t.ratioTasks,
            warning: ratios.overrunTasks.numerator > 0
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
            metric: ratios.estimateAccuracy,
            benchmark: comparison.ledgerEstimateAccuracyPercentage,
            sample: t.ratioTasks
          },
          {
            label: t.estimateCoverageRate,
            hint: t.estimateCoverageRateHint,
            metric: ratios.estimateCoverage,
            benchmark: comparison.ledgerEstimateCoveragePercentage,
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
        const teamReference = t.teamReferenceMethod(comparison.sampleSize);
        const metric = row.createDiv({
          cls: `pmi-ratio-metric${item.warning ? " is-warning" : ""}`,
          attr: {
            title: item.hint,
            "aria-label": `${item.label}: ${percentage}; ${sample}. ${item.hint} ${teamReference}`
          }
        });
        metric.createSpan({ cls: "pmi-ratio-name", text: item.label });
        metric.createEl("strong", { text: percentage });
        metric.createSpan({
          cls: "pmi-ratio-benchmark",
          text: t.compactTeamReference(item.benchmark),
          attr: { title: teamReference }
        });
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
