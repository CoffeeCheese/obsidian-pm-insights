import { Modal, setIcon, type App } from "obsidian";
import type {
  GateRiskMetric,
  GateRiskReason,
  GateRiskSnapshot,
  GateRiskState,
  ProjectGateRisk
} from "./domain/gate-risk";
import type { Translations } from "./i18n";
import type { PriorityRecord, ProjectRecord, TaskRecord } from "./model";
import { deliveryStageLabel } from "./delivery-stage-label";

interface GateRiskModalOptions {
  snapshot: GateRiskSnapshot;
  priorities: PriorityRecord[];
  translations: Translations;
  hasDeliveryIssues: boolean;
  openTask(taskId: string, projectPath: string): Promise<void> | void;
  openDeliveryIssues(): void;
  configureProject(project: ProjectRecord): void;
}

let nextRiskModalId = 0;

const STATE_ORDER: Record<GateRiskState, number> = {
  overdue: 6,
  high: 5,
  attention: 4,
  unconfigured: 3,
  normal: 2,
  "not-started": 1,
  passed: 0
};

export class GateRiskModal extends Modal {
  private activeProjectId: string;
  private readonly labelId = ++nextRiskModalId;

  constructor(app: App, private readonly options: GateRiskModalOptions) {
    super(app);
    this.activeProjectId = [...options.snapshot.projects]
      .sort((left, right) => STATE_ORDER[right.state] - STATE_ORDER[left.state])[0]
      ?.project.id ?? "";
  }

  onOpen(): void {
    this.modalEl.addClass("pmi-gate-risk-modal");
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { snapshot, translations: t } = this.options;
    this.contentEl.empty();
    const lead = this.contentEl.createDiv("pmi-risk-lead");
    const signal = lead.createSpan("pmi-risk-lead-signal");
    setIcon(signal, "shield-alert");
    const copy = lead.createDiv("pmi-risk-lead-copy");
    copy.createEl("h2", { text: t.gateRiskDetailsTitle });
    copy.createEl("p", { text: t.gateRiskDetailsSubtitle });
    copy.createEl("strong", {
      text: t.gateRiskSummary(
        snapshot.counts.overdue,
        snapshot.counts.high,
        snapshot.counts.attention,
        snapshot.counts.unconfigured
      )
    });

    const tabs = this.contentEl.createDiv({
      cls: "pmi-risk-project-tabs",
      attr: { role: "tablist", "aria-label": t.gateRiskProjects }
    });
    for (const [index, project] of snapshot.projects.entries()) {
      this.renderProjectTab(tabs, project, index, t);
    }

    const active = snapshot.projects.find((risk) => risk.project.id === this.activeProjectId);
    if (active) this.renderProject(active, t);

    if (this.options.hasDeliveryIssues) {
      const link = this.contentEl.createEl("button", {
        cls: "pmi-risk-delivery-issues-link",
        attr: { type: "button" }
      });
      setIcon(link.createSpan(), "scan-search");
      link.createSpan({ text: t.viewDeliveryIssues });
      setIcon(link.createSpan(), "chevron-right");
      link.addEventListener("click", () => this.options.openDeliveryIssues());
    }
  }

  private renderProjectTab(
    root: HTMLElement,
    risk: ProjectGateRisk,
    index: number,
    t: Translations
  ): void {
    const active = risk.project.id === this.activeProjectId;
    const button = root.createEl("button", {
      cls: `pmi-risk-project-tab is-${risk.state}${active ? " is-active" : ""}`,
      attr: {
        type: "button",
        role: "tab",
        id: this.tabId(index),
        "aria-controls": this.panelId,
        "aria-selected": String(active),
        tabindex: active ? "0" : "-1",
        "data-project-id": risk.project.id
      }
    });
    button.createSpan({ text: risk.project.icon });
    button.createSpan({ text: risk.project.title });
    button.createSpan({
      cls: "pmi-risk-state",
      text: this.stateLabel(risk.state, t)
    });
    button.addEventListener("click", () => this.activateProject(risk.project.id));
    button.addEventListener("keydown", (event) => this.handleProjectTabKey(event, index));
  }

  private renderProject(risk: ProjectGateRisk, t: Translations): void {
    const panel = this.contentEl.createDiv({
      cls: "pmi-risk-project-panel",
      attr: {
        role: "tabpanel",
        id: this.panelId,
        "aria-labelledby": this.tabId(this.options.snapshot.projects.findIndex(
          (candidate) => candidate.project.id === risk.project.id
        )),
        "data-project-id": risk.project.id
      }
    });
    if (!risk.configured) {
      const empty = panel.createDiv("pmi-risk-unconfigured");
      setIcon(empty.createSpan(), "calendar-off");
      const copy = empty.createDiv();
      copy.createEl("strong", { text: t.gatesNotConfigured });
      copy.createEl("p", { text: t.gateDatesRequired });
      const configure = empty.createEl("button", {
        cls: "pmi-risk-configure",
        text: t.configureProjectGates(risk.project.title),
        attr: { type: "button" }
      });
      configure.addEventListener("click", () => {
        this.close();
        this.options.configureProject(risk.project);
      });
      return;
    }

    const timeline = panel.createDiv("pmi-risk-timeline");
    for (const gate of risk.gates) {
      this.renderGate(timeline, risk.project, gate, gate === risk.nearestGate, t);
    }
  }

  private renderGate(
    root: HTMLElement,
    project: ProjectRecord,
    gate: GateRiskMetric,
    nearest: boolean,
    t: Translations
  ): void {
    const item = root.createEl("details", {
      cls: `pmi-risk-gate is-${gate.state}${gate.skipped ? " is-skipped" : ""}${nearest ? " is-nearest" : ""}`,
      attr: { "data-gate-id": gate.id }
    });
    item.open = gate.state === "overdue" || gate.state === "high" || gate.state === "attention";
    const summary = item.createEl("summary");
    const node = summary.createSpan("pmi-risk-gate-node");
    setIcon(node, this.gateIcon(gate));
    const main = summary.createDiv("pmi-risk-gate-main");
    const heading = main.createDiv("pmi-risk-gate-heading");
    heading.createEl("strong", { text: this.gateName(gate, t) });
    if (nearest) heading.createSpan({ cls: "pmi-risk-nearest", text: t.nearestGateBadge });
    heading.createSpan({
      cls: `pmi-risk-state is-progress-${gate.progressSignal}`,
      text: gate.skipped ? t.riskStateSkipped : this.gateStateLabel(gate, t)
    });
    main.createSpan({
      cls: "pmi-risk-gate-date",
      text: this.gateDateLabel(gate, t)
    });
    const progress = summary.createDiv("pmi-risk-gate-progress");
    progress.createEl("strong", { text: gate.skipped ? "—" : `${gate.progress}%` });
    if (gate.skipped) {
      progress.createSpan({ text: t.skippedStatistics });
    } else if (gate.progressSignal === "planned") {
      progress.createSpan({ text: t.gateProgressPlannedStart(gate.windowStart) });
    } else if (gate.progressSignal === "ahead") {
      progress.createSpan({ text: t.gateProgressAhead(gate.windowStart) });
    } else if (gate.progressSignal === "parallel") {
      progress.createSpan({
        text: gate.expectedProgress === 0
          ? t.gateProgressParallelStart(gate.windowStart)
          : t.gateProgressParallel(gate.expectedProgress)
      });
    } else if (gate.expectedProgress !== null && gate.state !== "passed") {
      progress.createSpan({ text: t.gateProgressExpected(gate.expectedProgress) });
    } else if (gate.timing) {
      progress.createSpan({ text: this.timingLabel(gate.timing, t) });
    }

    const body = item.createDiv("pmi-risk-gate-body");
    if (gate.reasons.length > 0) {
      const reasons = body.createDiv("pmi-risk-reasons");
      for (const reason of gate.reasons) {
        const row = reasons.createDiv();
        setIcon(row.createSpan(), "circle-alert");
        row.createSpan({ text: this.reasonLabel(reason, gate, t) });
      }
    }
    const qualityTotal = gate.quality.missingDue + gate.quality.unestimated + gate.quality.unassigned;
    if (qualityTotal > 0) {
      const quality = body.createDiv("pmi-risk-quality");
      setIcon(quality.createSpan(), "scan-search");
      quality.createSpan({
        text: t.gateQuality(
          gate.quality.missingDue,
          gate.quality.unestimated,
          gate.quality.unassigned
        )
      });
      if (this.options.hasDeliveryIssues) {
        const issues = quality.createEl("button", {
          cls: "pmi-risk-quality-link",
          text: t.viewDeliveryIssues,
          attr: { type: "button" }
        });
        issues.addEventListener("click", () => this.options.openDeliveryIssues());
      }
    }
    this.renderTaskGroup(body, project, t.gateRiskTasks, gate.tasks, gate, t);
    if (gate.blockingTasks.length > 0) {
      this.renderTaskGroup(body, project, t.gateBlockingTasks, gate.blockingTasks, gate, t);
    }
    if (gate.tasks.length === 0 && gate.blockingTasks.length === 0) {
      body.createDiv({ cls: "pmi-risk-no-tasks", text: t.gateNoRiskTasks });
    }
  }

  private renderTaskGroup(
    root: HTMLElement,
    project: ProjectRecord,
    label: string,
    tasks: TaskRecord[],
    gate: GateRiskMetric,
    t: Translations
  ): void {
    const unique = [...new Map(tasks.map((task) => [task.id, task])).values()];
    if (unique.length === 0) return;
    const group = root.createDiv("pmi-risk-task-group");
    group.createEl("h4", { text: `${label} ${unique.length}` });
    const list = group.createDiv("pmi-risk-task-list");
    for (const task of this.sortTasks(unique, gate)) {
      const button = list.createEl("button", {
        cls: "pmi-risk-task",
        attr: { type: "button", "aria-label": `${t.openTask}: ${task.title}` }
      });
      const copy = button.createDiv();
      copy.createEl("strong", { text: task.title });
      copy.createSpan({
        text: task.dueDate ? t.gateTaskDue(task.dueDate.slice(0, 10)) : t.gateTaskNoDue
      });
      setIcon(button.createSpan(), "arrow-up-right");
      button.addEventListener("click", () => {
        void this.options.openTask(task.id, project.path);
      });
    }
  }

  private sortTasks(tasks: TaskRecord[], gate: GateRiskMetric): TaskRecord[] {
    const today = this.options.snapshot.today;
    const priority = new Map(this.options.priorities.map((item, index) => [item.id, index]));
    const rank = (task: TaskRecord): number => {
      const due = task.dueDate?.slice(0, 10) ?? "";
      if (due && due < today) return 0;
      if (due && due > gate.gateDate) return 1;
      if (!due) return 2;
      return 3;
    };
    return [...tasks].sort((left, right) =>
      rank(left) - rank(right)
        || (left.dueDate ?? "9999").localeCompare(right.dueDate ?? "9999")
        || (priority.get(left.priority ?? "") ?? priority.size)
          - (priority.get(right.priority ?? "") ?? priority.size)
        || left.title.localeCompare(right.title)
    );
  }

  private activateProject(projectId: string): void {
    this.activeProjectId = projectId;
    this.render();
    this.contentEl.querySelector<HTMLButtonElement>(
      `.pmi-risk-project-tab[data-project-id="${CSS.escape(projectId)}"]`
    )?.focus();
  }

  private handleProjectTabKey(event: KeyboardEvent, index: number): void {
    const count = this.options.snapshot.projects.length;
    if (count === 0) return;
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % count;
    else if (event.key === "ArrowLeft") next = (index - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else return;
    event.preventDefault();
    const project = this.options.snapshot.projects[next];
    if (project) this.activateProject(project.project.id);
  }

  private tabId(index: number): string {
    return `pmi-risk-tab-${this.labelId}-${index}`;
  }

  private get panelId(): string {
    return `pmi-risk-panel-${this.labelId}`;
  }

  private gateName(gate: GateRiskMetric, t: Translations): string {
    if (gate.kind === "acceptance") return t.acceptanceGateLabel;
    if (gate.kind === "launch") return t.launchGateLabel;
    return deliveryStageLabel(gate.id, gate.name, t);
  }

  private gateIcon(gate: GateRiskMetric): string {
    if (gate.kind === "acceptance") return "badge-check";
    if (gate.kind === "launch") return "rocket";
    return gate.state === "passed" ? "check" : "diamond";
  }

  private stateLabel(state: GateRiskState, t: Translations): string {
    switch (state) {
      case "unconfigured": return t.riskStateUnconfigured;
      case "not-started": return t.riskStateNotStarted;
      case "normal": return t.riskStateNormal;
      case "attention": return t.riskStateAttention;
      case "high": return t.riskStateHigh;
      case "overdue": return t.riskStateOverdue;
      case "passed": return t.riskStatePassed;
    }
  }

  private gateStateLabel(gate: GateRiskMetric, t: Translations): string {
    if (gate.state === "normal" && gate.progressSignal === "parallel") {
      return t.riskStateParallel;
    }
    if (gate.state === "normal" && gate.progressSignal === "ahead") {
      return t.riskStateAhead;
    }
    return this.stateLabel(gate.state, t);
  }

  private reasonLabel(reason: GateRiskReason, gate: GateRiskMetric, t: Translations): string {
    switch (reason) {
      case "schedule-gap": return t.gateReasonScheduleGap(gate.progressGap ?? 0);
      case "window-closing": return t.gateReasonWindowClosing;
      case "task-overdue": return t.gateReasonTaskOverdue;
      case "task-after-gate": return t.gateReasonTaskAfterGate;
      case "gate-today": return t.gateReasonGateToday;
      case "gate-overdue": return t.gateReasonGateOverdue;
    }
  }

  private timingLabel(timing: NonNullable<GateRiskMetric["timing"]>, t: Translations): string {
    switch (timing) {
      case "early": return t.gateTimingEarly;
      case "on-time": return t.gateTimingOnTime;
      case "late": return t.gateTimingLate;
      case "unknown": return t.gateTimingUnknown;
    }
  }

  private gateDateLabel(gate: GateRiskMetric, t: Translations): string {
    if (gate.state === "passed") return gate.gateDate;
    return `${gate.gateDate} · ${gate.daysRemaining < 0
      ? t.gateDaysOverdue(Math.abs(gate.daysRemaining))
      : t.gateDaysRemaining(gate.daysRemaining)}`;
  }
}
