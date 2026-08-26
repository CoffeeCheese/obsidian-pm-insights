import { Modal, Notice, ToggleComponent, setIcon, type App } from "obsidian";
import type {
  GateRiskMetric,
  GateRiskReason,
  GateRiskSnapshot,
  GateRiskState,
  GateTaskRiskKind,
  GateTaskRiskSignal,
  ProjectGateRisk
} from "./domain/gate-risk";
import { gateRiskSummaryState, gateTaskRiskSignals } from "./domain/gate-risk";
import type { Translations } from "./i18n";
import type { PriorityRecord, ProjectRecord, TaskRecord } from "./model";
import { deliveryStageLabel } from "./delivery-stage-label";

interface GateRiskModalOptions {
  snapshot: GateRiskSnapshot;
  checkTaskDueDates: boolean;
  priorities: PriorityRecord[];
  translations: Translations;
  hasDeliveryIssues: boolean;
  openTask(taskId: string, projectPath: string): Promise<void> | void;
  openDeliveryIssues(): void;
  configureProject(project: ProjectRecord): void;
  setTaskDueDateChecks(enabled: boolean): Promise<GateRiskSnapshot>;
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

type GateTaskRiskTone = "critical" | "warning" | "quality" | "context";

export class GateRiskModal extends Modal {
  private activeProjectId: string;
  private snapshot: GateRiskSnapshot;
  private checkTaskDueDates: boolean;
  private readonly labelId = ++nextRiskModalId;

  constructor(app: App, private readonly options: GateRiskModalOptions) {
    super(app);
    this.snapshot = options.snapshot;
    this.checkTaskDueDates = options.checkTaskDueDates;
    this.activeProjectId = [...this.snapshot.projects]
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
    const { translations: t } = this.options;
    const snapshot = this.snapshot;
    this.contentEl.empty();
    const state = gateRiskSummaryState(snapshot.counts);
    const lead = this.contentEl.createDiv(`pmi-risk-lead is-${state}`);
    const signal = lead.createSpan("pmi-risk-lead-signal");
    setIcon(signal, state === "normal" ? "shield-check" : state === "unconfigured" ? "calendar-off" : "shield-alert");
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
    this.renderDueDateRule(lead, t);

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

  private renderDueDateRule(root: HTMLElement, t: Translations): void {
    const rule = root.createDiv({
      cls: `pmi-risk-rule${this.checkTaskDueDates ? " is-enabled" : " is-disabled"}`,
      attr: { title: t.checkTaskDueDatesDesc }
    });
    const icon = rule.createSpan("pmi-risk-rule-icon");
    setIcon(icon, "calendar-clock");
    const copy = rule.createDiv("pmi-risk-rule-copy");
    copy.createSpan({ text: t.gateDueDateRule });
    copy.createEl("small", {
      text: this.checkTaskDueDates
        ? t.gateDueDateRuleEnabled
        : t.gateDueDateRuleDisabled,
      attr: { "aria-live": "polite" }
    });
    const toggleHost = rule.createSpan("pmi-risk-rule-control");
    const toggle = new ToggleComponent(toggleHost)
      .setValue(this.checkTaskDueDates)
      .onChange((enabled) => void this.updateDueDateRule(enabled, toggle));
    toggle.toggleEl.addClass("pmi-risk-rule-toggle");
    toggle.toggleEl.setAttribute("aria-label", t.checkTaskDueDates);
    toggle.toggleEl.querySelector("input")?.setAttribute("aria-label", t.checkTaskDueDates);
  }

  private async updateDueDateRule(
    enabled: boolean,
    toggle: ToggleComponent
  ): Promise<void> {
    const previous = this.checkTaskDueDates;
    const rule = toggle.toggleEl.closest<HTMLElement>(".pmi-risk-rule");
    rule?.setAttribute("aria-busy", "true");
    toggle.setDisabled(true);
    try {
      this.snapshot = await this.options.setTaskDueDateChecks(enabled);
      this.checkTaskDueDates = enabled;
      if (!this.snapshot.projects.some((risk) => risk.project.id === this.activeProjectId)) {
        this.activeProjectId = this.snapshot.projects[0]?.project.id ?? "";
      }
      this.render();
      window.setTimeout(() => {
        this.contentEl.querySelector<HTMLElement>(".pmi-risk-rule-toggle")?.focus();
      }, 0);
    } catch {
      this.checkTaskDueDates = previous;
      toggle.setValue(previous);
      toggle.setDisabled(false);
      rule?.removeAttribute("aria-busy");
      new Notice(this.options.translations.gateDueDateRuleUpdateFailed);
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
        "aria-labelledby": this.tabId(this.snapshot.projects.findIndex(
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
      this.renderGate(timeline, risk.project, gate, risk.gates, gate === risk.nearestGate, t);
    }
  }

  private renderGate(
    root: HTMLElement,
    project: ProjectRecord,
    gate: GateRiskMetric,
    projectGates: GateRiskMetric[],
    nearest: boolean,
    t: Translations
  ): void {
    const hasDelayTimeline = this.hasDelayTimeline(gate);
    const item = root.createEl("details", {
      cls: `pmi-risk-gate is-${gate.state}${gate.skipped ? " is-skipped" : ""}${nearest ? " is-nearest" : ""}${hasDelayTimeline ? " has-delay-timeline" : ""}`,
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
    if (hasDelayTimeline) {
      this.renderDelayTimeline(main, gate, t);
    } else {
      main.createSpan({
        cls: "pmi-risk-gate-date",
        text: this.gateDateLabel(gate, t)
      });
    }
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
          gate.quality.unassigned,
          gate.dueDateChecksEnabled
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
    if (gate.kind === "launch") {
      this.renderLaunchOverview(body, gate, projectGates, t);
      return;
    }
    this.renderTaskGroup(body, project, t.gateRiskTasks, gate.tasks, gate, t);
    if (gate.blockingTasks.length > 0) {
      this.renderTaskGroup(body, project, t.gateBlockingTasks, gate.blockingTasks, gate, t, true);
    }
    if (gate.tasks.length === 0 && gate.blockingTasks.length === 0) {
      body.createDiv({ cls: "pmi-risk-no-tasks", text: t.gateNoRiskTasks });
    }
  }

  private renderDelayTimeline(
    root: HTMLElement,
    gate: GateRiskMetric,
    t: Translations
  ): void {
    const baseline = gate.baselineDate ?? gate.gateDate;
    const forecast = gate.forecastDate && gate.forecastDate !== baseline
      ? gate.forecastDate
      : null;
    const actual = gate.actualDate && gate.actualDate !== (forecast ?? baseline)
      ? gate.actualDate
      : null;
    const forecastOutcome = gate.delayDays !== null && gate.delayDays !== undefined
      ? t.gateDelayExpected(gate.delayDays, gate.includeWeekends)
      : null;
    const actualOutcome = gate.actualDelayDays !== null && gate.actualDelayDays !== undefined
      ? t.gateDelayActualResult(gate.actualDelayDays, gate.includeWeekends)
      : null;
    const variance = gate.forecastVarianceDays !== null && gate.forecastVarianceDays !== undefined
      ? t.gateDelayVariance(gate.forecastVarianceDays, gate.includeWeekends)
      : null;
    const aria = [
      `${t.gateRiskBaselineTrack} ${baseline}`,
      forecast ? `${t.gateDelayForecast} ${forecast}` : "",
      actual ? `${t.gateDelayActual} ${actual}` : "",
      actualOutcome ?? forecastOutcome ?? "",
      variance ?? "",
      gate.forecastMissed ? t.gateDelayNeedsReforecast : "",
      this.gateTimeStatusLabel(gate, t)
    ].filter(Boolean).join("; ");
    const track = root.createDiv({
      cls: `pmi-risk-gate-schedule${gate.forecastMissed ? " is-missed" : ""}`,
      attr: { role: "group", "aria-label": aria }
    });
    this.renderDelayStop(track, "baseline", t.gateRiskBaselineTrack, baseline);
    if (forecast) {
      this.renderDelaySegment(track, "forecast", t.gateRiskForecastTrack, forecast);
    }
    if (actual) {
      this.renderDelaySegment(track, "actual", t.gateRiskActualTrack, actual);
    }
    const outcome = actualOutcome ?? forecastOutcome;
    if (outcome) {
      const outcomeEl = track.createSpan({
        cls: `pmi-risk-gate-schedule-outcome${actualOutcome ? " is-actual" : ""}`,
        text: outcome
      });
      if (variance) outcomeEl.setAttribute("title", variance);
    }
    if (gate.forecastMissed) {
      const missed = track.createSpan({
        cls: "pmi-risk-gate-schedule-alert",
        attr: { title: t.gateDelayNeedsReforecast, "aria-hidden": "true" }
      });
      setIcon(missed, "triangle-alert");
    }
    const clock = this.gateTimeStatusLabel(gate, t);
    if (clock) {
      track.createSpan({ cls: "pmi-risk-gate-schedule-clock", text: clock });
    }
  }

  private renderDelaySegment(
    root: HTMLElement,
    kind: "forecast" | "actual",
    label: string,
    value: string
  ): void {
    const segment = root.createSpan("pmi-risk-gate-schedule-segment");
    const connector = segment.createSpan({
      cls: "pmi-risk-gate-schedule-connector",
      attr: { "aria-hidden": "true" }
    });
    setIcon(connector, "arrow-right");
    this.renderDelayStop(segment, kind, label, value);
  }

  private renderDelayStop(
    root: HTMLElement,
    kind: "baseline" | "forecast" | "actual",
    label: string,
    value: string
  ): void {
    const stop = root.createSpan({
      cls: `pmi-risk-gate-schedule-stop is-${kind}`,
      attr: { "aria-hidden": "true" }
    });
    stop.createSpan({ text: label });
    stop.createEl("time", { text: value, attr: { datetime: value } });
  }

  private hasDelayTimeline(gate: GateRiskMetric): boolean {
    if (!gate.delayStatus || !gate.baselineDate) return false;
    return Boolean(
      (gate.forecastDate && gate.forecastDate !== gate.baselineDate)
      || (gate.actualDate && gate.actualDate !== gate.baselineDate)
    );
  }

  private renderLaunchOverview(
    root: HTMLElement,
    gate: GateRiskMetric,
    projectGates: GateRiskMetric[],
    t: Translations
  ): void {
    const upstream = projectGates.filter((candidate) => candidate.kind !== "launch");
    const passed = upstream.filter((candidate) => candidate.state === "passed").length;
    const risks = upstream.filter((candidate) =>
      candidate.state === "attention" || candidate.state === "high" || candidate.state === "overdue"
    ).length;
    const openTasks = new Set(gate.tasks.map((task) => task.id)).size;
    const blockers = new Set(gate.blockingTasks.map((task) => task.id)).size;
    const overview = root.createDiv({
      cls: "pmi-risk-launch-overview",
      attr: { role: "group", "aria-label": t.launchOverviewTitle }
    });
    const heading = overview.createDiv("pmi-risk-launch-overview-heading");
    setIcon(heading.createSpan(), "clipboard-check");
    heading.createEl("strong", { text: t.launchOverviewTitle });
    const stats = overview.createDiv("pmi-risk-launch-stats");
    const summaryItems: Array<[string, string, string]> = [
      ["passed", t.launchPassedGates, `${passed}/${upstream.length}`],
      ["risk", t.launchRiskGates, String(risks)],
      ["tasks", t.launchOpenTasks, String(openTasks)],
      ["blockers", t.launchAcceptanceBlockers, String(blockers)]
    ];
    for (const [key, label, value] of summaryItems) {
      const stat = stats.createDiv({ cls: "pmi-risk-launch-stat", attr: { "data-summary": key } });
      stat.createSpan({ text: label });
      stat.createEl("strong", { text: value });
    }
    overview.createDiv({ cls: "pmi-risk-launch-hint", text: t.launchOverviewHint });
  }

  private renderTaskGroup(
    root: HTMLElement,
    project: ProjectRecord,
    label: string,
    tasks: TaskRecord[],
    gate: GateRiskMetric,
    t: Translations,
    acceptanceBlockers = false
  ): void {
    const unique = [...new Map(tasks.map((task) => [task.id, task])).values()];
    if (unique.length === 0) return;
    const group = root.createDiv("pmi-risk-task-group");
    group.createEl("h4", { text: `${label} ${unique.length}` });
    const list = group.createDiv("pmi-risk-task-list");
    for (const task of this.sortTasks(unique, gate)) {
      const signals = this.sortTaskRiskSignals(gateTaskRiskSignals(
        task,
        gate,
        this.snapshot.today,
        acceptanceBlockers
      ));
      const labels = signals.map((signal) => this.taskRiskLabel(signal, gate, t));
      const primaryTone = this.primaryTaskRiskTone(signals);
      const button = list.createEl("button", {
        cls: `pmi-risk-task is-risk-${primaryTone}`,
        attr: {
          type: "button",
          "aria-label": `${t.openTask}: ${task.title}. ${t.gateTaskRiskReasons}: ${labels.join(", ")}`
        }
      });
      const copy = button.createDiv("pmi-risk-task-copy");
      copy.createEl("strong", { text: task.title });
      const evidence = copy.createDiv({
        cls: "pmi-risk-task-evidence",
        attr: { "aria-hidden": "true" }
      });
      for (const [index, signal] of signals.entries()) {
        const label = labels[index] ?? this.taskRiskLabel(signal, gate, t);
        evidence.createSpan({
          cls: `pmi-risk-task-signal is-${this.taskRiskTone(signal.kind)}${index === 0 ? " is-primary" : ""}`,
          text: label,
          attr: { "data-risk-kind": signal.kind }
        });
      }
      if (task.dueDate || gate.dueDateChecksEnabled) {
        evidence.createSpan({
          cls: "pmi-risk-task-date",
          text: task.dueDate ? t.gateTaskDue(task.dueDate.slice(0, 10)) : t.gateTaskNoDue
        });
      }
      setIcon(button.createSpan(), "arrow-up-right");
      button.addEventListener("click", () => {
        void this.options.openTask(task.id, project.path);
      });
    }
  }

  private sortTasks(tasks: TaskRecord[], gate: GateRiskMetric): TaskRecord[] {
    const today = this.snapshot.today;
    const priority = new Map(this.options.priorities.map((item, index) => [item.id, index]));
    const rank = (task: TaskRecord): number => {
      if (!gate.dueDateChecksEnabled) return 0;
      const due = task.dueDate?.slice(0, 10) ?? "";
      if (due && due < today) return 0;
      if (due && due > gate.gateDate) return 1;
      if (!due) return 2;
      return 3;
    };
    return [...tasks].sort((left, right) =>
      rank(left) - rank(right)
        || (gate.dueDateChecksEnabled
          ? (left.dueDate ?? "9999").localeCompare(right.dueDate ?? "9999")
          : 0)
        || (priority.get(left.priority ?? "") ?? priority.size)
          - (priority.get(right.priority ?? "") ?? priority.size)
        || left.title.localeCompare(right.title)
    );
  }

  private primaryTaskRiskTone(signals: GateTaskRiskSignal[]): GateTaskRiskTone {
    const order: GateTaskRiskTone[] = ["critical", "warning", "quality", "context"];
    return order.find((tone) => signals.some((signal) => this.taskRiskTone(signal.kind) === tone))
      ?? "context";
  }

  private sortTaskRiskSignals(signals: GateTaskRiskSignal[]): GateTaskRiskSignal[] {
    const order: Record<GateTaskRiskTone, number> = {
      critical: 0,
      warning: 1,
      quality: 2,
      context: 3
    };
    return [...signals].sort((left, right) =>
      order[this.taskRiskTone(left.kind)] - order[this.taskRiskTone(right.kind)]
    );
  }

  private taskRiskTone(kind: GateTaskRiskKind): GateTaskRiskTone {
    switch (kind) {
      case "task-overdue":
      case "gate-overdue":
      case "acceptance-blocker":
        return "critical";
      case "task-after-gate":
      case "gate-today":
      case "schedule-gap":
      case "window-closing":
      case "acceptance-incomplete":
        return "warning";
      case "missing-due":
      case "unestimated":
      case "unassigned":
        return "quality";
      case "awaiting-acceptance":
      case "unfinished":
        return "context";
    }
  }

  private taskRiskLabel(
    signal: GateTaskRiskSignal,
    gate: GateRiskMetric,
    t: Translations
  ): string {
    switch (signal.kind) {
      case "task-overdue":
        return t.gateTaskRiskOverdue(signal.days ?? 0, gate.includeWeekends);
      case "task-after-gate":
        return t.gateTaskRiskAfterGate(signal.days ?? 0, gate.includeWeekends);
      case "missing-due": return t.gateTaskRiskMissingDue;
      case "unestimated": return t.gateTaskRiskUnestimated;
      case "unassigned": return t.gateTaskRiskUnassigned;
      case "acceptance-blocker": return t.gateTaskRiskAcceptanceBlocker;
      case "awaiting-acceptance": return t.gateTaskRiskAwaitingAcceptance;
      case "acceptance-incomplete": return t.gateTaskRiskAcceptanceIncomplete;
      case "gate-overdue":
        return t.gateTaskRiskGateOverdue(signal.days ?? 0, gate.includeWeekends);
      case "gate-today": return t.gateTaskRiskGateToday;
      case "schedule-gap": return t.gateTaskRiskScheduleGap;
      case "window-closing": return t.gateTaskRiskWindowClosing;
      case "unfinished": return t.gateTaskRiskUnfinished;
    }
  }

  private activateProject(projectId: string): void {
    this.activeProjectId = projectId;
    this.render();
    this.contentEl.querySelector<HTMLButtonElement>(
      `.pmi-risk-project-tab[data-project-id="${CSS.escape(projectId)}"]`
    )?.focus();
  }

  private handleProjectTabKey(event: KeyboardEvent, index: number): void {
    const count = this.snapshot.projects.length;
    if (count === 0) return;
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % count;
    else if (event.key === "ArrowLeft") next = (index - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else return;
    event.preventDefault();
    const project = this.snapshot.projects[next];
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
    return `${gate.gateDate} · ${this.gateTimeStatusLabel(gate, t)}`;
  }

  private gateTimeStatusLabel(gate: GateRiskMetric, t: Translations): string {
    if (gate.state === "passed") return "";
    return gate.state === "overdue"
      ? t.gateDaysOverdue(Math.abs(gate.daysRemaining), gate.includeWeekends)
      : t.gateDaysRemaining(
          gate.daysRemaining,
          gate.includeWeekends,
          gate.gateDate === this.snapshot.today
        );
  }
}
