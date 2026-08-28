import { ButtonComponent, Modal, setIcon, type App } from "obsidian";
import { ConfirmActionModal } from "./confirm-action-modal";
import {
  ACCEPTANCE_GATE_ID,
  LAUNCH_GATE_ID,
  actualGateDelayDays,
  addScheduleDays,
  baselineGateDate,
  cloneForecast,
  emptyActualState,
  forecastFromSchedule,
  forecastHasDelay,
  forecastVarianceDays,
  gateBaselineEditPolicy,
  gateDelayDays,
  gateForecastDateFromDelay,
  gateForecastDate,
  pendingDelayEvaluationRevision,
  setGateForecastDate,
  settleDelayEvaluationRevision,
  withdrawDelayRevision,
  withdrawableDelayRevision,
  validateGateForecast
} from "./domain/gate-delay";
import { isDateOnly, validateGateSchedule } from "./domain/gate-schedule";
import { scheduleDaysBetween } from "./domain/schedule-calendar";
import type { Translations } from "./i18n";
import type {
  DeliveryStageSettings,
  GateActualEvent,
  GateDateChangeSource,
  GateDelayRevision,
  GateDelayRevisionKind,
  ProjectGateActualState,
  ProjectGateDelayPlan,
  ProjectGateForecast,
  ProjectGateSchedule,
  ProjectRecord
} from "./model";

interface ProjectGatesModalState {
  schedule: ProjectGateSchedule;
  delay: ProjectGateDelayPlan | null;
  actuals: ProjectGateActualState;
}

interface ProjectGatesModalOptions {
  project: ProjectRecord;
  stages: DeliveryStageSettings[];
  stageName(stage: DeliveryStageSettings): string;
  schedule: ProjectGateSchedule | undefined;
  delay: ProjectGateDelayPlan | undefined;
  actuals: ProjectGateActualState | undefined;
  today: string;
  translations: Translations;
  save(state: ProjectGatesModalState): Promise<void>;
}

type GateEditorTab = "baseline" | "delay";

const MAX_DELAY_DAYS = 9999;

interface DurationRow {
  element: HTMLElement;
  from: () => string;
  to: () => string;
  projectDuration: boolean;
}

interface DelayEvaluationSnapshot {
  delay: ProjectGateDelayPlan | undefined;
  delayDirty: boolean;
  pendingChanges: Record<string, GateDateChangeSource>;
  reason: string;
}

class ProjectNameConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly options: {
      project: string;
      translations: Translations;
      confirm(): void;
    }
  ) {
    super(app);
  }

  onOpen(): void {
    const t = this.options.translations;
    this.modalEl.addClass("pmi-delay-clear-modal");
    this.titleEl.setText(t.gateDelayClearTitle);
    const signal = this.contentEl.createDiv("pmi-delay-clear-signal");
    setIcon(signal.createSpan(), "archive-x");
    signal.createEl("p", { text: t.gateDelayClearMessage(this.options.project) });
    const label = this.contentEl.createEl("label", { cls: "pmi-delay-clear-field" });
    label.createSpan({ text: t.gateDelayTypeProject });
    const input = label.createEl("input", { type: "text" });
    const error = this.contentEl.createDiv({
      cls: "pmi-delay-clear-error",
      attr: { role: "status", "aria-live": "polite" }
    });
    const actions = this.contentEl.createDiv("pmi-confirm-action-actions");
    new ButtonComponent(actions).setButtonText(t.cancel).onClick(() => this.close());
    const confirm = new ButtonComponent(actions).setButtonText(t.gateDelayClearConfirm);
    confirm.buttonEl.addClass("is-destructive");
    confirm.setDisabled(true).onClick(() => {
      if (input.value !== this.options.project) {
        error.setText(t.gateDelayClearMismatch);
        return;
      }
      this.close();
      this.options.confirm();
    });
    input.addEventListener("input", () => {
      const valid = input.value === this.options.project;
      confirm.setDisabled(!valid);
      error.setText(input.value && !valid ? t.gateDelayClearMismatch : "");
    });
    window.setTimeout(() => input.focus());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class ProjectGatesModal extends Modal {
  private baseline: ProjectGateSchedule;
  private savedBaseline: ProjectGateSchedule;
  private delay: ProjectGateDelayPlan | undefined;
  private actuals: ProjectGateActualState;
  private activeTab: GateEditorTab = "baseline";
  private baselineDirty = false;
  private delayDirty = false;
  private allowClose = false;
  private confirmationOpen = false;
  private durationRows: DurationRow[] = [];
  private pendingChanges: Record<string, GateDateChangeSource> = {};
  private reason = "";
  private launchDate = "";
  private launchReason = "";
  private evaluationSnapshot: DelayEvaluationSnapshot | undefined;

  constructor(app: App, private readonly options: ProjectGatesModalOptions) {
    super(app);
    this.baseline = options.schedule
      ? {
          ...structuredClone(options.schedule),
          includeWeekends: options.schedule.includeWeekends !== false
        }
      : {
          startDate: "",
          stageGates: {},
          acceptanceGate: "",
          launchDate: "",
          includeWeekends: true
        };
    this.delay = options.delay ? structuredClone(options.delay) : undefined;
    this.savedBaseline = structuredClone(this.baseline);
    this.actuals = structuredClone(options.actuals ?? emptyActualState());
    this.launchDate = this.actuals.launchDate ?? options.today;
  }

  onOpen(): void {
    this.modalEl.addClass("pmi-project-gates-modal");
    this.render();
  }

  onClose(): void {
    this.durationRows = [];
    this.contentEl.empty();
  }

  close(): void {
    if (!this.allowClose && (this.baselineDirty || this.delayDirty)) {
      if (this.confirmationOpen) return;
      this.confirmationOpen = true;
      const t = this.options.translations;
      new ConfirmActionModal(this.app, {
        title: t.gateEditorTitle,
        message: t.discardGateChanges,
        cancel: t.cancel,
        confirm: t.discardChanges,
        destructive: true,
        onConfirm: () => {
          this.baselineDirty = false;
          this.delayDirty = false;
          this.allowClose = true;
          super.close();
        },
        onCancel: () => { this.confirmationOpen = false; }
      }).open();
      return;
    }
    this.allowClose = true;
    super.close();
  }

  private render(): void {
    this.durationRows = [];
    this.contentEl.empty();
    this.renderLead();
    this.renderTabs();
    const panel = this.contentEl.createDiv({
      cls: "pmi-gate-editor-panel",
      attr: { role: "tabpanel", tabindex: "0" }
    });
    panel.id = `pmi-gate-${this.activeTab}-panel`;
    panel.setAttribute("aria-labelledby", `pmi-gate-${this.activeTab}-tab`);
    if (this.activeTab === "baseline") this.renderBaseline(panel);
    else this.renderDelay(panel);
  }

  private renderLead(): void {
    const { project, translations: t } = this.options;
    const lead = this.contentEl.createDiv("pmi-gate-editor-lead");
    const signal = lead.createSpan("pmi-gate-editor-signal");
    setIcon(signal, "milestone");
    const copy = lead.createDiv("pmi-gate-editor-copy");
    copy.createEl("h2", { text: t.gateEditorTitle });
    copy.createEl("strong", { text: `${project.icon} ${project.title}` });
    copy.createEl("p", { text: t.gateEditorDesc });
    if (this.delay?.revisions.length) {
      const status = lead.createDiv(`pmi-delay-status is-${this.delay.status}`);
      setIcon(status.createSpan(), this.delayStatusIcon());
      status.createSpan({ text: this.delayStatusLabel() });
    }
  }

  private renderTabs(): void {
    const t = this.options.translations;
    const tabs = this.contentEl.createDiv({
      cls: "pmi-gate-editor-tabs",
      attr: { role: "tablist", "aria-label": t.gateEditorTitle }
    });
    for (const [tab, label, icon] of [
      ["baseline", t.gateBaselineTab, "route"],
      ["delay", t.gateDelayTab, "git-compare-arrows"]
    ] as const) {
      const button = tabs.createEl("button", {
        cls: `pmi-gate-editor-tab${this.activeTab === tab ? " is-active" : ""}`,
        attr: {
          type: "button",
          role: "tab",
          id: `pmi-gate-${tab}-tab`,
          "aria-selected": String(this.activeTab === tab),
          "aria-controls": `pmi-gate-${tab}-panel`,
          tabindex: this.activeTab === tab ? "0" : "-1"
        }
      });
      setIcon(button.createSpan(), icon);
      button.createSpan({ text: label });
      if (tab === "delay" && this.delay?.revisions.length) {
        button.createSpan({ cls: "pmi-gate-tab-indicator", text: "" });
      }
      button.addEventListener("click", () => {
        this.activeTab = tab;
        this.render();
      });
    }
  }

  private renderBaseline(root: HTMLElement): void {
    const t = this.options.translations;
    const policy = gateBaselineEditPolicy(this.delay);
    const locked = !policy.canEditDates;
    const delayForecast = this.delay?.draft ?? this.delay?.confirmed;
    if (locked) {
      const notice = root.createDiv("pmi-gate-baseline-lock");
      setIcon(notice.createSpan(), "lock-keyhole");
      const copy = notice.createDiv();
      copy.createEl("strong", { text: t.gateBaselineLocked });
      copy.createEl("p", { text: t.gateBaselineLockedDesc });
      const manage = notice.createEl("button", { text: t.gateDelayManage, attr: { type: "button" } });
      manage.addEventListener("click", () => {
        this.activeTab = "delay";
        this.render();
      });
    }
    this.renderCalendarRule(root, !policy.canEditCalendarRule);
    const timeline = root.createDiv("pmi-gate-editor-timeline");
    this.baselineDateField(timeline, "flag", t.projectStartDate, this.baseline.startDate, (value) => {
      this.baseline.startDate = value;
    }, "start", undefined, undefined, false, locked);
    for (const [index, stage] of this.options.stages.entries()) {
      const previousStage = this.options.stages[index - 1];
      this.baselineDateField(
        timeline,
        "diamond",
        t.stageGateDate(this.options.stageName(stage)),
        this.baseline.stageGates[stage.id] ?? "",
        (value) => { this.baseline.stageGates[stage.id] = value; },
        stage.id,
        index,
        () => previousStage
          ? this.baseline.stageGates[previousStage.id] ?? ""
          : this.baseline.startDate,
        false,
        locked,
        delayForecast
      );
    }
    const lastStage = this.options.stages.at(-1);
    this.baselineDateField(
      timeline,
      "badge-check",
      t.acceptanceGateDate,
      this.baseline.acceptanceGate,
      (value) => { this.baseline.acceptanceGate = value; },
      ACCEPTANCE_GATE_ID,
      undefined,
      () => lastStage ? this.baseline.stageGates[lastStage.id] ?? "" : this.baseline.startDate,
      false,
      locked,
      delayForecast
    );
    this.baselineDateField(
      timeline,
      "rocket",
      t.launchReminderDate,
      this.baseline.launchDate,
      (value) => { this.baseline.launchDate = value; },
      LAUNCH_GATE_ID,
      undefined,
      () => this.baseline.startDate,
      true,
      locked,
      delayForecast
    );
    const validation = root.createDiv({
      cls: "pmi-gate-editor-validation",
      attr: { role: "status", "aria-live": "polite" }
    });
    const result = validateGateSchedule(this.baseline, this.stageIds());
    validation.setText(this.baselineValidationMessage(result));
    const footer = root.createDiv("pmi-gate-editor-footer");
    new ButtonComponent(footer).setButtonText(t.cancel).onClick(() => this.close());
    const save = new ButtonComponent(footer).setButtonText(t.saveGates).setCta();
    save.buttonEl.addClass("pmi-gate-editor-save");
    save.setDisabled(!policy.canSave || !result.valid);
    save.onClick(() => void this.saveBaseline());
    this.updateDurations();
  }

  private baselineDateField(
    root: HTMLElement,
    icon: string,
    label: string,
    value: string,
    update: (value: string) => void,
    gateId: string,
    stageIndex?: number,
    durationFrom?: () => string,
    projectDuration = false,
    disabled = false,
    delayForecast?: ProjectGateForecast
  ): void {
    const t = this.options.translations;
    const delayDays = delayForecast ? gateDelayDays(this.baseline, delayForecast, gateId) : 0;
    const row = root.createDiv("pmi-gate-editor-row");
    row.toggleClass("has-delay-reference", delayDays > 0);
    row.dataset.gateId = gateId;
    if (stageIndex !== undefined) row.dataset.stageIndex = String(stageIndex);
    const node = row.createSpan("pmi-gate-editor-node");
    setIcon(node, icon);
    const field = row.createEl("label", { cls: "pmi-gate-editor-field" });
    const labelCopy = field.createDiv("pmi-gate-editor-field-copy");
    const title = labelCopy.createDiv("pmi-gate-editor-field-title");
    title.createSpan({ text: label });
    if (delayForecast && delayDays > 0) {
      title.createSpan({
        cls: "pmi-gate-baseline-delay-offset",
        text: t.gateBaselineDelayOffset(delayDays, this.baseline.includeWeekends),
        attr: {
          title: t.gateBaselineDelayForecastTitle(gateForecastDate(delayForecast, gateId)),
          "aria-label": `${t.gateBaselineDelayForecastTitle(gateForecastDate(delayForecast, gateId))}; ${t.gateBaselineDelayOffset(delayDays, this.baseline.includeWeekends)}`
        }
      });
    }
    const duration = labelCopy.createEl("small", {
      text: durationFrom ? "" : this.options.translations.gateTimelineStart
    });
    const input = field.createEl("input", {
      type: "date",
      value,
      attr: { "aria-label": label }
    });
    input.disabled = disabled;
    if (durationFrom) {
      this.durationRows.push({ element: duration, from: durationFrom, to: () => input.value, projectDuration });
    }
    input.addEventListener("change", () => {
      update(input.value);
      this.updateBaselineDirty();
      this.render();
    });
  }

  private renderCalendarRule(root: HTMLElement, disabled: boolean): void {
    const t = this.options.translations;
    const rule = root.createDiv("pmi-gate-calendar-rule");
    const signal = rule.createSpan("pmi-gate-calendar-signal");
    setIcon(signal, "calendar-days");
    const copy = rule.createDiv("pmi-gate-calendar-copy");
    copy.createEl("strong", { text: t.gateCalendarRuleTitle });
    copy.createSpan({ text: t.gateCalendarRuleDesc });
    const toggle = rule.createEl("button", {
      cls: "pmi-gate-calendar-toggle",
      attr: { type: "button", role: "switch" }
    });
    toggle.disabled = disabled;
    const weekend = toggle.createSpan("pmi-gate-calendar-weekend");
    weekend.createSpan({ text: t.gateWeekendSaturday });
    weekend.createSpan({ text: t.gateWeekendSunday });
    const state = toggle.createSpan("pmi-gate-calendar-state");
    state.createSpan({ cls: "pmi-gate-calendar-toggle-label", text: t.gateSkipWeekends });
    const mode = state.createEl("strong");
    const workdaysOnly = !this.baseline.includeWeekends;
    toggle.classList.toggle("is-workday-only", workdaysOnly);
    toggle.setAttribute("aria-checked", String(workdaysOnly));
    const modeLabel = workdaysOnly ? t.gateWorkingDays : t.gateCalendarDays;
    toggle.setAttribute("aria-label", `${t.gateSkipWeekends}: ${modeLabel}`);
    mode.setText(modeLabel);
    toggle.addEventListener("click", () => {
      this.baseline.includeWeekends = !this.baseline.includeWeekends;
      this.updateBaselineDirty();
      this.render();
    });
  }

  private renderDelay(root: HTMLElement): void {
    const t = this.options.translations;
    const baselineValidation = validateGateSchedule(this.baseline, this.stageIds());
    if (this.baselineDirty || !baselineValidation.valid) {
      if (this.baselineDirty && !gateBaselineEditPolicy(this.delay).canEditDates) {
        this.renderDelayClockPending(root);
        return;
      }
      const empty = root.createDiv("pmi-delay-empty");
      setIcon(empty.createSpan("pmi-delay-empty-icon"), "route-off");
      empty.createEl("h3", { text: t.gateBaselineTab });
      empty.createEl("p", { text: this.baselineDirty ? t.saveGates : this.baselineValidationMessage(baselineValidation) });
      const action = empty.createEl("button", { text: t.gateBaselineTab, attr: { type: "button" } });
      action.addEventListener("click", () => {
        this.activeTab = "baseline";
        this.render();
      });
      return;
    }
    if (!this.delay?.revisions.length && !this.delay?.draft) {
      this.renderDelayEmpty(root);
      this.renderLaunchAction(root);
      if (this.actuals.events.length > 0) this.renderHistory(root);
      return;
    }

    this.renderDelayHero(root);
    const forecast = this.delay.draft ?? this.delay.confirmed;
    const editingEvaluation = Boolean(this.delay.draft && this.evaluationSnapshot);
    if (forecast) this.renderDelayTimeline(root, forecast, editingEvaluation);
    if (editingEvaluation) this.renderDelayActions(root);
    else this.renderSettledDelayActions(root);
    this.renderLaunchAction(root);
    this.renderHistory(root);
    this.renderDangerZone(root);
  }

  private renderDelayClockPending(root: HTMLElement): void {
    const t = this.options.translations;
    const pending = root.createDiv({
      cls: "pmi-delay-clock-pending",
      attr: { role: "region", "aria-labelledby": "pmi-delay-clock-pending-title" }
    });
    const heading = pending.createDiv("pmi-delay-clock-pending-heading");
    const signal = heading.createSpan("pmi-delay-clock-pending-signal");
    setIcon(signal, "calendar-clock");
    const copy = heading.createDiv("pmi-delay-clock-pending-copy");
    copy.createSpan({ cls: "pmi-delay-clock-pending-kicker", text: t.gateDelayClockPendingKicker });
    copy.createEl("h3", {
      text: t.gateDelayClockPendingTitle,
      attr: { id: "pmi-delay-clock-pending-title" }
    });
    copy.createEl("p", { text: t.gateDelayClockPendingBody });

    const route = pending.createDiv("pmi-delay-clock-route");
    this.renderDelayClockState(
      route,
      t.gateDelayClockSavedRule,
      this.savedBaseline.includeWeekends,
      false
    );
    const arrow = route.createSpan("pmi-delay-clock-route-arrow");
    setIcon(arrow, "arrow-right");
    this.renderDelayClockState(
      route,
      t.gateDelayClockPendingRule,
      this.baseline.includeWeekends,
      true
    );

    const impact = pending.createDiv("pmi-delay-clock-impact");
    setIcon(impact.createSpan(), "calculator");
    impact.createSpan({ text: t.gateDelayClockPendingImpact });

    const actions = pending.createDiv("pmi-delay-clock-actions");
    const discard = new ButtonComponent(actions).setButtonText(t.gateDelayClockDiscard);
    discard.buttonEl.addClass("pmi-delay-clock-action", "is-discard");
    discard.onClick(() => {
      this.baseline.includeWeekends = this.savedBaseline.includeWeekends;
      this.updateBaselineDirty();
      this.render();
    });
    const save = new ButtonComponent(actions).setButtonText(t.gateDelayClockSave).setCta();
    save.buttonEl.addClass("pmi-delay-clock-action", "is-save");
    save.onClick(() => void this.saveBaseline());
  }

  private renderDelayClockState(
    root: HTMLElement,
    label: string,
    includeWeekends: boolean,
    pending: boolean
  ): void {
    const state = root.createDiv(`pmi-delay-clock-state${pending ? " is-pending" : ""}`);
    state.createSpan({ text: label });
    const mode = state.createEl("strong");
    setIcon(mode.createSpan(), includeWeekends ? "calendar-days" : "calendar-off");
    mode.createSpan({
      text: includeWeekends
        ? this.options.translations.gateCalendarDays
        : this.options.translations.gateWorkingDays
    });
  }

  private renderDelayEmpty(root: HTMLElement): void {
    const t = this.options.translations;
    const empty = root.createDiv("pmi-delay-empty");
    const icon = empty.createSpan("pmi-delay-empty-icon");
    setIcon(icon, "git-compare-arrows");
    empty.createEl("h3", { text: t.gateDelayEmptyTitle });
    empty.createEl("p", { text: t.gateDelayEmptyBody });
    const action = new ButtonComponent(empty).setButtonText(t.gateStartDelay).setCta();
    action.onClick(() => {
      this.startEvaluation();
      this.render();
    });
  }

  private renderDelayHero(root: HTMLElement): void {
    if (!this.delay) return;
    const t = this.options.translations;
    const forecast = this.delay.draft ?? this.delay.confirmed
      ?? forecastFromSchedule(this.baseline);
    const days = gateDelayDays(this.baseline, forecast, LAUNCH_GATE_ID);
    const hero = root.createDiv(`pmi-delay-hero is-${this.delay.status}`);
    const signal = hero.createSpan("pmi-delay-hero-signal");
    setIcon(signal, this.delayStatusIcon());
    const copy = hero.createDiv("pmi-delay-hero-copy");
    copy.createSpan({ cls: "pmi-delay-hero-kicker", text: this.delayStatusLabel() });
    copy.createEl("strong", { text: t.gateDelayStatusSummary(days, this.baseline.includeWeekends) });
    copy.createEl("p", { text: t.gateDelayPlanDesc });
    if (this.confirmedForecastMissed()) {
      const missed = hero.createDiv("pmi-delay-missed");
      setIcon(missed.createSpan(), "triangle-alert");
      missed.createSpan({ text: t.gateDelayNeedsReforecast });
    }
  }

  private renderDelayTimeline(
    root: HTMLElement,
    forecast: ProjectGateForecast,
    editable: boolean
  ): void {
    if (editable) {
      const hint = root.createDiv("pmi-delay-edit-hint");
      setIcon(hint.createSpan(), "calculator");
      hint.createSpan({
        text: this.options.translations.gateDelayEditHint(this.baseline.includeWeekends)
      });
    }
    const timeline = root.createDiv("pmi-delay-timeline");
    timeline.createDiv({ cls: "pmi-delay-track-line", attr: { "aria-hidden": "true" } });
    for (const gateId of this.gateIds()) {
      const actual = gateId === LAUNCH_GATE_ID
        ? this.actuals.launchDate
        : this.actuals.gates[gateId]?.open === false
          ? this.actuals.gates[gateId]?.date
          : undefined;
      const row = timeline.createDiv("pmi-delay-row");
      row.dataset.gateId = gateId;
      const marker = row.createDiv("pmi-delay-marker");
      marker.createSpan("pmi-delay-marker-baseline");
      marker.createSpan("pmi-delay-marker-forecast");
      if (actual) marker.createSpan("pmi-delay-marker-actual");
      const body = row.createDiv("pmi-delay-row-body");
      const heading = body.createDiv("pmi-delay-row-heading");
      heading.createEl("strong", { text: this.gateLabel(gateId) });
      const plannedDays = gateDelayDays(this.baseline, forecast, gateId);
      heading.createSpan({
        cls: `pmi-delay-outcome${plannedDays > 0 ? " is-delayed" : ""}`,
        text: this.options.translations.gateDelayExpected(plannedDays, this.baseline.includeWeekends)
      });
      const tracks = body.createDiv("pmi-delay-row-tracks");
      this.renderDateTrack(tracks, "baseline", this.options.translations.gateDelayBaseline,
        baselineGateDate(this.baseline, gateId));
      if (editable && !actual) {
        tracks.addClass("is-forecast-editable");
        this.renderForecastEditor(tracks, forecast, gateId, plannedDays);
      } else {
        this.renderDateTrack(tracks, "forecast", this.options.translations.gateDelayForecast,
          gateForecastDate(forecast, gateId));
      }
      if (actual) {
        this.renderDateTrack(tracks, "actual", this.options.translations.gateDelayActual, actual);
        const actualDays = actualGateDelayDays(this.baseline, actual, gateId);
        const variance = forecastVarianceDays(this.baseline, forecast, actual, gateId);
        const result = body.createDiv("pmi-delay-actual-result");
        result.createSpan({ text: this.options.translations.gateDelayActualResult(actualDays, this.baseline.includeWeekends) });
        result.createSpan({ text: this.options.translations.gateDelayVariance(variance, this.baseline.includeWeekends) });
      }
    }
  }

  private renderForecastEditor(
    root: HTMLElement,
    forecast: ProjectGateForecast,
    gateId: string,
    plannedDays: number
  ): void {
    const t = this.options.translations;
    const gateLabel = this.gateLabel(gateId);
    const field = root.createDiv("pmi-delay-date-track is-forecast is-editable");
    field.createSpan({ text: t.gateDelayForecast });
    const editor = field.createDiv("pmi-delay-forecast-editor");
    const dateField = editor.createEl("label", { cls: "pmi-delay-forecast-control is-date" });
    dateField.createSpan({ text: t.gateDelayDateInput });
    const dateInput = dateField.createEl("input", {
      type: "date",
      value: gateForecastDate(forecast, gateId),
      attr: {
        min: baselineGateDate(this.baseline, gateId),
        "aria-label": `${gateLabel} · ${t.gateDelayDateInput}`
      }
    });
    dateInput.addEventListener("change", () => {
      this.updateForecastDate(gateId, dateInput.value);
      this.render();
    });

    const bridge = editor.createSpan({
      cls: "pmi-delay-forecast-bridge",
      attr: { "aria-hidden": "true" }
    });
    setIcon(bridge, "arrow-left-right");

    const daysField = editor.createDiv("pmi-delay-forecast-control is-days");
    daysField.createSpan({ text: t.gateDelayDaysInput });
    const daysControl = daysField.createDiv("pmi-delay-days-control");
    const decrementLabel = t.gateDelayDecrementAria(gateLabel, this.baseline.includeWeekends);
    const decrementButton = daysControl.createEl("button", {
      cls: "pmi-delay-days-step is-decrement",
      text: "−",
      attr: {
        type: "button",
        "aria-label": decrementLabel,
        title: decrementLabel
      }
    });
    decrementButton.disabled = plannedDays <= 0;
    const daysInput = daysControl.createEl("input", {
      cls: "pmi-delay-days-input",
      type: "text",
      value: String(plannedDays),
      attr: {
        inputmode: "numeric",
        pattern: "[0-9]*",
        autocomplete: "off",
        spellcheck: "false",
        "aria-label": t.gateDelayDaysAria(gateLabel, this.baseline.includeWeekends)
      }
    });
    daysControl.createSpan({
      cls: "pmi-delay-days-unit",
      text: t.gateDelayDaysUnit(this.baseline.includeWeekends)
    });
    const incrementLabel = t.gateDelayIncrementAria(gateLabel, this.baseline.includeWeekends);
    const incrementButton = daysControl.createEl("button", {
      cls: "pmi-delay-days-step is-increment",
      text: "+",
      attr: {
        type: "button",
        "aria-label": incrementLabel,
        title: incrementLabel
      }
    });
    incrementButton.disabled = plannedDays >= MAX_DELAY_DAYS;
    const adjustDelayDays = (delta: number): void => {
      const nextDelayDays = Math.max(0, Math.min(plannedDays + delta, MAX_DELAY_DAYS));
      this.updateForecastDate(
        gateId,
        gateForecastDateFromDelay(this.baseline, gateId, nextDelayDays)
      );
      this.render();
    };
    decrementButton.addEventListener("click", () => adjustDelayDays(-1));
    incrementButton.addEventListener("click", () => adjustDelayDays(1));
    daysInput.addEventListener("input", () => daysInput.setCustomValidity(""));
    daysInput.addEventListener("change", () => {
      const delayDays = Number(daysInput.value);
      if (!Number.isInteger(delayDays) || delayDays < 0 || delayDays > MAX_DELAY_DAYS) {
        daysInput.setCustomValidity(t.gateDelayDaysInvalid(MAX_DELAY_DAYS));
        daysInput.reportValidity();
        daysInput.value = String(plannedDays);
        return;
      }
      this.updateForecastDate(
        gateId,
        gateForecastDateFromDelay(this.baseline, gateId, delayDays)
      );
      this.render();
    });
  }

  private renderDateTrack(root: HTMLElement, kind: string, label: string, value: string): void {
    const track = root.createDiv(`pmi-delay-date-track is-${kind}`);
    track.createSpan({ text: label });
    track.createEl("time", { text: value, attr: { datetime: value } });
  }

  private renderDelayActions(root: HTMLElement): void {
    if (!this.delay?.draft) return;
    const t = this.options.translations;
    const validation = validateGateForecast(
      this.baseline,
      this.delay.draft,
      this.stageIds(),
      this.actuals,
      this.options.today
    );
    const form = root.createDiv("pmi-delay-action-panel");
    const reason = form.createEl("label", { cls: "pmi-delay-reason" });
    reason.createSpan({ text: t.gateDelayReason });
    const textarea = reason.createEl("textarea", {
      placeholder: t.gateDelayReasonPlaceholder,
      attr: { rows: "4" }
    });
    textarea.value = this.reason;
    textarea.addEventListener("input", () => {
      this.reason = textarea.value;
      this.delayDirty = true;
    });
    const message = form.createDiv({
      cls: "pmi-gate-editor-validation",
      attr: { role: "status", "aria-live": "polite" }
    });
    message.setText(this.forecastValidationMessage(validation));
    const actions = form.createDiv("pmi-delay-actions");
    if (this.evaluationSnapshot) {
      const cancel = actions.createEl("button", {
        cls: "pmi-delay-action is-cancel",
        attr: { type: "button" }
      });
      setIcon(cancel.createSpan(), "x");
      cancel.createSpan({ text: t.gateDelayCancelEvaluation });
      cancel.addEventListener("click", () => this.cancelEvaluation());
    }
    const save = new ButtonComponent(actions).setButtonText(t.gateDelaySaveEvaluation);
    save.buttonEl.addClass("pmi-delay-action", "is-save");
    save.setDisabled(!validation.valid).onClick(() => void this.saveEvaluation(message));
    const hasDelay = forecastHasDelay(
      this.baseline,
      this.delay.draft,
      this.stageIds(),
      this.actuals
    );
    const confirmingRestore = Boolean(this.delay.confirmed && !hasDelay);
    const confirm = new ButtonComponent(actions)
      .setButtonText(confirmingRestore ? t.gateDelayConfirmRestore : t.gateDelayConfirm)
      .setCta();
    confirm.buttonEl.addClass("pmi-delay-action", "is-confirm");
    confirm.setDisabled(!validation.valid || (!hasDelay && !this.delay.confirmed))
      .onClick(() => void this.confirmEvaluation(message));
  }

  private renderSettledDelayActions(root: HTMLElement): void {
    if (!this.delay || this.delay.status === "completed") return;
    if (pendingDelayEvaluationRevision(this.delay)) return;
    const actions = root.createDiv("pmi-delay-settled-actions");
    const button = new ButtonComponent(actions)
      .setButtonText(this.options.translations.gateDelayCreateEvaluation)
      .setCta();
    button.onClick(() => {
      this.startEvaluation();
      this.render();
    });
  }

  private renderLaunchAction(root: HTMLElement): void {
    const acceptance = this.actuals.gates[ACCEPTANCE_GATE_ID];
    if (!this.delay?.revisions.length && !this.actuals.launchDate && (!acceptance || acceptance.open)) return;
    const t = this.options.translations;
    const section = root.createDiv("pmi-launch-record");
    const heading = section.createDiv("pmi-launch-record-heading");
    setIcon(heading.createSpan(), "rocket");
    heading.createEl("strong", { text: this.actuals.launchDate ? t.gateLaunchCorrect : t.gateLaunchRecord });
    if (!acceptance || acceptance.open) {
      section.createEl("p", { text: t.gateLaunchPendingAcceptance });
      return;
    }
    if (this.delay?.draft) {
      section.createEl("p", { text: t.gateLaunchDraftPending });
      return;
    }
    const fields = section.createDiv("pmi-launch-record-fields");
    const date = fields.createEl("label");
    date.createSpan({ text: t.gateLaunchDate });
    const input = date.createEl("input", {
      type: "date",
      value: this.launchDate,
      attr: { min: acceptance.date, max: this.options.today }
    });
    input.addEventListener("change", () => { this.launchDate = input.value; });
    if (this.actuals.launchDate) {
      const reason = fields.createEl("label");
      reason.createSpan({ text: t.gateDelayReason });
      const textarea = reason.createEl("textarea", {
        placeholder: t.gateDelayReasonPlaceholder,
        attr: { rows: "2" }
      });
      textarea.value = this.launchReason;
      textarea.addEventListener("input", () => { this.launchReason = textarea.value; });
    }
    const error = section.createDiv({
      cls: "pmi-gate-editor-validation",
      attr: { role: "status", "aria-live": "polite" }
    });
    const action = new ButtonComponent(section)
      .setButtonText(this.actuals.launchDate ? t.gateLaunchCorrect : t.gateLaunchRecord)
      .setCta();
    action.onClick(() => void this.recordLaunch(error));
  }

  private renderHistory(root: HTMLElement): void {
    const t = this.options.translations;
    const section = root.createDiv("pmi-delay-history");
    const heading = section.createDiv("pmi-delay-section-heading");
    setIcon(heading.createSpan(), "history");
    heading.createEl("h3", { text: t.gateDelayHistory });
    const items = [
      ...(this.delay?.revisions ?? [])
        .filter((revision) => revision.kind !== "withdrawn" || !revision.targetRevisionId)
        .map((revision) => ({
        createdAt: revision.createdAt,
        type: "revision" as const,
        revision
      })),
      ...this.actuals.events.map((actual) => ({
        createdAt: actual.createdAt,
        type: "actual" as const,
        actual
      }))
    ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    if (items.length === 0) {
      section.createEl("p", { cls: "pmi-delay-history-empty", text: t.gateDelayHistoryEmpty });
      return;
    }
    const timeline = section.createDiv("pmi-delay-history-list");
    for (const item of items) {
      if (item.type === "revision") this.renderRevision(timeline, item.revision);
      else this.renderActualEvent(timeline, item.actual);
    }
  }

  private renderRevision(root: HTMLElement, revision: GateDelayRevision): void {
    const revisionIndex = this.delay?.revisions.findIndex((candidate) => candidate.id === revision.id) ?? -1;
    const previous = revisionIndex > 0 ? this.delay?.revisions[revisionIndex - 1] : undefined;
    const withdrawnAt = this.revisionWithdrawnAt(revision);
    const withdrawn = Boolean(withdrawnAt);
    const confirmable = this.confirmableEvaluationRevision()?.id === revision.id;
    const withdrawable = withdrawableDelayRevision(this.delay)?.id === revision.id;
    const item = root.createEl("details", {
      cls: `pmi-delay-history-item is-${revision.kind}${withdrawn ? " is-withdrawn-target" : ""}${confirmable ? " is-decision-pending" : ""}`
    });
    if (confirmable) item.open = true;
    const summary = item.createEl("summary");
    const marker = summary.createSpan("pmi-delay-history-marker");
    setIcon(marker, this.revisionIcon(revision.kind));
    const copy = summary.createDiv("pmi-delay-history-summary");
    const title = copy.createDiv("pmi-delay-history-title");
    title.createEl("strong", { text: this.revisionLabel(revision.kind) });
    if (confirmable) title.createSpan({
      cls: "is-decision-pending",
      text: this.options.translations.gateDelayDecisionPending
    });
    if (withdrawn) title.createSpan({ text: this.options.translations.gateDelayItemWithdrawn });
    copy.createSpan({
      text: this.options.translations.gateDelayStatusSummary(
        gateDelayDays(this.baseline, revision.forecast, LAUNCH_GATE_ID),
        this.baseline.includeWeekends
      )
    });
    summary.createEl("time", { text: this.formatTimestamp(revision.createdAt) });
    const body = item.createDiv("pmi-delay-history-body");
    if (revision.reason) body.createEl("blockquote", { text: revision.reason });
    const rows = body.createDiv("pmi-delay-history-diff");
    for (const gateId of this.gateIds(revision.stages.map((stage) => stage.id))) {
      const row = rows.createDiv("pmi-delay-history-diff-row");
      row.createSpan({ text: this.gateLabel(gateId, revision.stages) });
      const currentDate = gateForecastDate(revision.forecast, gateId);
      const previousDate = previous ? gateForecastDate(previous.forecast, gateId) : "";
      row.createEl("time", {
        text: previousDate && previousDate !== currentDate
          ? `${previousDate} → ${currentDate}`
          : currentDate
      });
      row.createSpan({
        text: this.options.translations.gateDelayExpected(
          gateDelayDays(this.baseline, revision.forecast, gateId),
          this.baseline.includeWeekends
        )
      });
      row.createSpan({
        cls: "pmi-delay-change-source",
        text: this.changeSourceLabel(revision.changes[gateId] ?? "system")
      });
    }
    if (withdrawnAt) {
      const note = body.createDiv("pmi-delay-withdrawn-note");
      setIcon(note.createSpan(), "undo-2");
      note.createSpan({
        text: this.options.translations.gateDelayWithdrawnAt(
          this.formatTimestamp(withdrawnAt)
        )
      });
    }
    if (revision.decidedAt) {
      const note = body.createDiv("pmi-delay-decided-note");
      setIcon(note.createSpan(), revision.kind === "restored" ? "shield-check" : "badge-check");
      note.createSpan({
        text: this.options.translations.gateDelayDecidedAt(
          this.formatTimestamp(revision.decidedAt),
          revision.kind === "restored"
        )
      });
    }
    if (confirmable) {
      this.renderEvaluationDecision(body, revision, withdrawable);
    } else if (withdrawable) {
      const action = body.createDiv("pmi-delay-history-action");
      action.createSpan({ text: this.options.translations.gateDelayWithdrawHint });
      const button = action.createEl("button", {
        cls: "pmi-delay-history-withdraw",
        attr: { type: "button" }
      });
      setIcon(button.createSpan(), "undo-2");
      button.createSpan({ text: this.options.translations.gateDelayWithdraw });
      button.addEventListener("click", () => this.confirmWithdrawRevision(revision));
    }
  }

  private renderEvaluationDecision(
    root: HTMLElement,
    revision: GateDelayRevision,
    withdrawable: boolean
  ): void {
    const t = this.options.translations;
    const validation = validateGateForecast(
      this.baseline,
      revision.forecast,
      this.stageIds(),
      this.actuals,
      this.options.today
    );
    const restoring = Boolean(
      this.delay?.confirmed
      && !forecastHasDelay(this.baseline, revision.forecast, this.stageIds(), this.actuals)
    );
    const decision = root.createDiv({
      cls: "pmi-delay-history-decision",
      attr: { role: "region", "aria-label": t.gateDelayDecisionPending }
    });
    const signal = decision.createSpan("pmi-delay-history-decision-signal");
    setIcon(signal, "git-pull-request-arrow");
    const copy = decision.createDiv("pmi-delay-history-decision-copy");
    copy.createEl("strong", { text: t.gateDelayDecisionPending });
    copy.createSpan({
      text: validation.valid
        ? t.gateDelayDecisionHint(restoring)
        : this.forecastValidationMessage(validation)
    });
    const actions = decision.createDiv("pmi-delay-history-decision-actions");
    if (withdrawable) {
      const withdraw = actions.createEl("button", {
        cls: "pmi-delay-history-withdraw",
        attr: { type: "button" }
      });
      setIcon(withdraw.createSpan(), "undo-2");
      withdraw.createSpan({ text: t.gateDelayWithdraw });
      withdraw.addEventListener("click", () => this.confirmWithdrawRevision(revision));
    }
    const confirm = actions.createEl("button", {
      cls: "pmi-delay-history-confirm",
      attr: { type: "button" }
    });
    setIcon(confirm.createSpan(), restoring ? "shield-check" : "badge-check");
    confirm.createSpan({
      text: restoring ? t.gateDelayConfirmRestore : t.gateDelayConfirmEvaluation
    });
    confirm.disabled = !validation.valid;
    confirm.addEventListener("click", () => void this.confirmSavedEvaluation(revision));
  }

  private renderActualEvent(root: HTMLElement, actual: GateActualEvent): void {
    const item = root.createDiv(`pmi-delay-history-item is-${actual.kind}`);
    const summary = item.createDiv("pmi-delay-actual-event");
    const marker = summary.createSpan("pmi-delay-history-marker");
    setIcon(marker, actual.kind === "reopened" ? "rotate-ccw" : actual.gateId === LAUNCH_GATE_ID ? "rocket" : "check");
    const copy = summary.createDiv("pmi-delay-history-summary");
    copy.createEl("strong", { text: `${this.actualEventLabel(actual.kind)} · ${this.gateLabel(actual.gateId)}` });
    const detail = actual.previousDate && actual.date
      ? `${actual.previousDate} → ${actual.date}`
      : actual.date ?? actual.previousDate ?? "";
    const source = actual.source === "observed"
      ? this.options.translations.gateActualObserved
      : actual.source === "tasks"
        ? this.options.translations.gateActualFromTasks
        : "";
    copy.createSpan({ text: [detail, source].filter(Boolean).join(" · ") });
    summary.createEl("time", { text: this.formatTimestamp(actual.createdAt) });
    if (actual.reason) item.createEl("blockquote", { text: actual.reason });
  }

  private renderDangerZone(root: HTMLElement): void {
    if (!this.delay?.revisions.length) return;
    const t = this.options.translations;
    const danger = root.createDiv("pmi-delay-danger");
    const copy = danger.createDiv();
    copy.createEl("strong", { text: t.gateDelayManage });
    copy.createEl("p", { text: t.gateDelayManageDesc });
    const clear = new ButtonComponent(danger).setButtonText(t.gateDelayClearAll);
    clear.buttonEl.addClass("is-destructive");
    clear.onClick(() => {
      new ProjectNameConfirmModal(this.app, {
        project: this.options.project.title,
        translations: t,
        confirm: () => void this.clearDelayData()
      }).open();
    });
  }

  private updateForecastDate(gateId: string, nextDate: string): void {
    const draft = this.delay?.draft;
    if (!draft) return;
    const oldDate = gateForecastDate(draft, gateId);
    setGateForecastDate(draft, gateId, nextDate);
    this.pendingChanges[gateId] = "manual";
    if (isDateOnly(oldDate) && isDateOnly(nextDate)) {
      const shift = scheduleDaysBetween(oldDate, nextDate, this.baseline.includeWeekends);
      const start = this.gateIds().indexOf(gateId);
      for (const downstreamId of this.gateIds().slice(start + 1)) {
        const actual = downstreamId === LAUNCH_GATE_ID
          ? this.actuals.launchDate
          : this.actuals.gates[downstreamId]?.open === false
            ? this.actuals.gates[downstreamId]?.date
            : undefined;
        if (actual) continue;
        setGateForecastDate(
          draft,
          downstreamId,
          addScheduleDays(gateForecastDate(draft, downstreamId), shift, this.baseline.includeWeekends)
        );
        this.pendingChanges[downstreamId] = "linked";
      }
    }
    this.delayDirty = true;
  }

  private startEvaluation(): void {
    if (this.evaluationSnapshot || pendingDelayEvaluationRevision(this.delay)) return;
    this.evaluationSnapshot = {
      delay: this.delay ? structuredClone(this.delay) : undefined,
      delayDirty: this.delayDirty,
      pendingChanges: structuredClone(this.pendingChanges),
      reason: this.reason
    };
    const base = this.delay?.draft
      ? cloneForecast(this.delay.draft)
      : this.delay?.confirmed
        ? cloneForecast(this.delay.confirmed)
        : forecastFromSchedule(this.baseline);
    for (const gateId of this.gateIds()) {
      const actual = gateId === LAUNCH_GATE_ID
        ? this.actuals.launchDate
        : this.actuals.gates[gateId]?.open === false
          ? this.actuals.gates[gateId]?.date
          : undefined;
      if (actual) setGateForecastDate(base, gateId, actual);
    }
    this.delay = {
      ...(this.delay ?? { revisions: [] }),
      status: "evaluating",
      draft: base
    };
    this.pendingChanges = {};
    this.reason = "";
    this.delayDirty = true;
  }

  private cancelEvaluation(): void {
    const snapshot = this.evaluationSnapshot;
    if (!snapshot) return;
    const restore = (): void => {
      this.delay = snapshot.delay ? structuredClone(snapshot.delay) : undefined;
      this.delayDirty = snapshot.delayDirty;
      this.pendingChanges = structuredClone(snapshot.pendingChanges);
      this.reason = snapshot.reason;
      this.evaluationSnapshot = undefined;
      this.confirmationOpen = false;
      this.render();
    };
    const hasChanges = Object.keys(this.pendingChanges).length > 0 || this.reason.length > 0;
    if (!hasChanges) {
      restore();
      return;
    }
    if (this.confirmationOpen) return;
    this.confirmationOpen = true;
    const t = this.options.translations;
    new ConfirmActionModal(this.app, {
      title: t.gateDelayCancelEvaluationTitle,
      message: t.gateDelayCancelEvaluationMessage(Boolean(snapshot.delay)),
      cancel: t.gateDelayContinueEvaluation,
      confirm: t.gateDelayCancelEvaluationConfirm,
      onConfirm: restore,
      onCancel: () => { this.confirmationOpen = false; }
    }).open();
  }

  private async saveEvaluation(message: HTMLElement): Promise<void> {
    if (!this.delay?.draft) return;
    if (pendingDelayEvaluationRevision(this.delay)) {
      message.setText(this.options.translations.gateDelayEvaluationPending);
      return;
    }
    if (this.delay.revisions.length > 0 && !this.reason.trim()) {
      message.setText(this.options.translations.gateDelayReasonRequired);
      return;
    }
    const hasDelay = forecastHasDelay(this.baseline, this.delay.draft, this.stageIds(), this.actuals);
    const kind: GateDelayRevisionKind = !hasDelay && !this.delay.confirmed ? "resolved" : "evaluation";
    const revision = this.revision(kind, this.delay.draft);
    this.delay.revisions.push(revision);
    if (kind === "resolved") {
      this.delay.status = "resolved";
      delete this.delay.draft;
      delete this.delay.pendingEvaluationRevisionId;
    } else {
      this.delay.status = "evaluating";
      this.delay.pendingEvaluationRevisionId = revision.id;
    }
    await this.persist();
    this.evaluationSnapshot = undefined;
    this.reason = "";
    this.pendingChanges = {};
    this.delayDirty = false;
    this.render();
  }

  private async confirmEvaluation(message: HTMLElement): Promise<void> {
    if (!this.delay?.draft || pendingDelayEvaluationRevision(this.delay)) return;
    if (!this.reason.trim()) {
      message.setText(this.options.translations.gateDelayReasonRequired);
      return;
    }
    const forecast = cloneForecast(this.delay.draft);
    const hasDelay = forecastHasDelay(this.baseline, forecast, this.stageIds(), this.actuals);
    if (!hasDelay && !this.delay.confirmed) return;
    const restoring = Boolean(this.delay.confirmed && !hasDelay);
    const revision = this.revision(restoring ? "restored" : "confirmed", forecast);
    this.delay.revisions.push(revision);
    delete this.delay.draft;
    delete this.delay.pendingEvaluationRevisionId;
    if (restoring) {
      this.delay.status = "restored";
      delete this.delay.confirmed;
      delete this.delay.confirmedRevisionId;
    } else {
      this.delay.status = "confirmed";
      this.delay.confirmed = forecast;
      this.delay.confirmedRevisionId = revision.id;
    }
    await this.persist();
    this.evaluationSnapshot = undefined;
    this.reason = "";
    this.pendingChanges = {};
    this.delayDirty = false;
    this.render();
  }

  private async confirmSavedEvaluation(revision: GateDelayRevision): Promise<void> {
    if (!this.delay || this.confirmableEvaluationRevision()?.id !== revision.id) return;
    const validation = validateGateForecast(
      this.baseline,
      revision.forecast,
      this.stageIds(),
      this.actuals,
      this.options.today
    );
    if (!validation.valid) return;
    const restoring = Boolean(
      this.delay.confirmed
      && !forecastHasDelay(this.baseline, revision.forecast, this.stageIds(), this.actuals)
    );
    const settled = settleDelayEvaluationRevision(
      this.delay,
      revision.id,
      restoring,
      new Date().toISOString()
    );
    if (!settled) return;
    this.delay = settled;
    await this.persist();
    this.evaluationSnapshot = undefined;
    this.reason = "";
    this.pendingChanges = {};
    this.delayDirty = false;
    this.render();
  }

  private confirmableEvaluationRevision(): GateDelayRevision | undefined {
    if (this.evaluationSnapshot || this.delayDirty || this.delay?.status !== "evaluating"
        || !this.delay.draft) return undefined;
    return pendingDelayEvaluationRevision(this.delay);
  }

  private confirmWithdrawRevision(revision: GateDelayRevision): void {
    const t = this.options.translations;
    new ConfirmActionModal(this.app, {
      title: t.gateDelayWithdrawTitle,
      message: t.gateDelayWithdrawMessage(
        this.revisionLabel(revision.kind),
        this.delayDirty
      ),
      cancel: t.cancel,
      confirm: t.gateDelayWithdrawConfirm,
      icon: "undo-2",
      destructive: true,
      onConfirm: () => void this.withdrawRevision(revision)
    }).open();
  }

  private async withdrawRevision(revision: GateDelayRevision): Promise<void> {
    if (!this.delay) return;
    const rolledBack = withdrawDelayRevision(this.delay, revision.id, new Date().toISOString());
    if (!rolledBack) return;
    this.delay = rolledBack;
    await this.persist();
    this.evaluationSnapshot = undefined;
    this.reason = "";
    this.pendingChanges = {};
    this.delayDirty = false;
    this.render();
  }

  private async recordLaunch(error: HTMLElement): Promise<void> {
    const acceptance = this.actuals.gates[ACCEPTANCE_GATE_ID];
    const correcting = Boolean(this.actuals.launchDate);
    if (!acceptance || acceptance.open || !isDateOnly(this.launchDate)
        || this.launchDate < acceptance.date || this.launchDate > this.options.today) {
      error.setText(this.options.translations.gateLaunchDateInvalid);
      return;
    }
    if (correcting && !this.launchReason.trim()) {
      error.setText(this.options.translations.gateDelayReasonRequired);
      return;
    }
    const now = new Date().toISOString();
    const previousDate = this.actuals.launchDate;
    this.actuals.launchDate = this.launchDate;
    this.actuals.launchRecordedAt = now;
    this.actuals.events.push({
      id: `${now}:launch:${this.actuals.events.length + 1}`,
      createdAt: now,
      kind: correcting ? "launch-corrected" : "launch",
      gateId: LAUNCH_GATE_ID,
      date: this.launchDate,
      source: "manual",
      ...(previousDate ? { previousDate } : {}),
      ...(this.launchReason.trim() ? { reason: this.launchReason.trim() } : {})
    });
    if (this.delay) this.delay.status = "completed";
    await this.persist();
    this.launchReason = "";
    this.delayDirty = false;
    this.render();
  }

  private revision(kind: GateDelayRevisionKind, forecast: ProjectGateForecast): GateDelayRevision {
    const createdAt = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      createdAt,
      kind,
      reason: this.reason.trim(),
      forecast: cloneForecast(forecast),
      stages: this.options.stages.map((stage, order) => ({
        id: stage.id,
        name: this.options.stageName(stage),
        order
      })),
      changes: structuredClone(this.pendingChanges)
    };
  }

  private async saveBaseline(): Promise<void> {
    await this.persist();
    this.savedBaseline = structuredClone(this.baseline);
    this.baselineDirty = false;
    this.render();
  }

  private updateBaselineDirty(): void {
    const stageIds = new Set([
      ...Object.keys(this.baseline.stageGates),
      ...Object.keys(this.savedBaseline.stageGates)
    ]);
    this.baselineDirty = this.baseline.startDate !== this.savedBaseline.startDate
      || this.baseline.acceptanceGate !== this.savedBaseline.acceptanceGate
      || this.baseline.launchDate !== this.savedBaseline.launchDate
      || this.baseline.includeWeekends !== this.savedBaseline.includeWeekends
      || [...stageIds].some((id) =>
        this.baseline.stageGates[id] !== this.savedBaseline.stageGates[id]
      );
  }

  private async clearDelayData(): Promise<void> {
    this.delay = undefined;
    this.delayDirty = false;
    this.evaluationSnapshot = undefined;
    this.reason = "";
    this.pendingChanges = {};
    await this.persist();
    this.activeTab = "baseline";
    this.render();
  }

  private async persist(): Promise<void> {
    await this.options.save({
      schedule: structuredClone(this.baseline),
      delay: this.delay ? structuredClone(this.delay) : null,
      actuals: structuredClone(this.actuals)
    });
  }

  private gateIds(stageIds = this.stageIds()): string[] {
    return [...stageIds, ACCEPTANCE_GATE_ID, LAUNCH_GATE_ID];
  }

  private stageIds(): string[] {
    return this.options.stages.map((stage) => stage.id);
  }

  private gateLabel(
    gateId: string,
    stages: Array<DeliveryStageSettings | { id: string; name: string }> = this.options.stages
  ): string {
    const t = this.options.translations;
    if (gateId === ACCEPTANCE_GATE_ID) return t.acceptanceGateDate;
    if (gateId === LAUNCH_GATE_ID) return t.launchReminderDate;
    const stage = stages.find((candidate) => candidate.id === gateId);
    const name = stage && "tags" in stage
      ? this.options.stageName(stage)
      : stage?.name ?? gateId;
    return t.stageGateDate(name);
  }

  private updateDurations(): void {
    const t = this.options.translations;
    for (const row of this.durationRows) {
      const from = row.from();
      const to = row.to();
      if (!isDateOnly(from) || !isDateOnly(to) || to < from) {
        row.element.setText("");
        continue;
      }
      const days = scheduleDaysBetween(from, to, this.baseline.includeWeekends);
      row.element.setText(row.projectDuration
        ? t.gateProjectDuration(days, this.baseline.includeWeekends)
        : t.gateWindowDuration(days, this.baseline.includeWeekends));
    }
  }

  private baselineValidationMessage(result: ReturnType<typeof validateGateSchedule>): string {
    const t = this.options.translations;
    return result.valid
      ? ""
      : result.missing.length > 0
        ? t.gateDatesRequired
        : result.invalid.length > 0
          ? t.gateDatesInvalid
          : t.gateDatesOrderInvalid;
  }

  private forecastValidationMessage(result: ReturnType<typeof validateGateForecast>): string {
    const t = this.options.translations;
    if (result.valid) return "";
    if (result.missing.length > 0) return t.gateDatesRequired;
    if (result.invalid.length > 0) return t.gateDatesInvalid;
    if (result.beforeBaseline.length > 0) return t.gateDelayBeforeBaseline;
    if (result.inPast.length > 0) return t.gateDelayInPast;
    return t.gateDatesOrderInvalid;
  }

  private confirmedForecastMissed(): boolean {
    if (!this.delay?.confirmed) return false;
    return this.gateIds().some((gateId) => {
      const actual = gateId === LAUNCH_GATE_ID
        ? this.actuals.launchDate
        : this.actuals.gates[gateId]?.open === false
          ? this.actuals.gates[gateId]?.date
          : undefined;
      return !actual && gateForecastDate(this.delay!.confirmed!, gateId) < this.options.today;
    });
  }

  private delayStatusIcon(): string {
    if (this.delay?.status === "confirmed") return "badge-check";
    if (this.delay?.status === "completed") return "rocket";
    if (this.delay?.status === "withdrawn") return "undo-2";
    if (this.delay?.status === "resolved" || this.delay?.status === "restored") return "shield-check";
    return "scan-search";
  }

  private delayStatusLabel(): string {
    const t = this.options.translations;
    if (this.delay?.status === "confirmed") return t.gateDelayConfirmed;
    if (this.delay?.status === "completed") return t.gateDelayCompleted;
    if (this.delay?.status === "resolved") return t.gateDelayResolved;
    if (this.delay?.status === "restored") return t.gateDelayRestored;
    if (this.delay?.status === "withdrawn") return t.gateDelayWithdrawn;
    return t.gateDelayEvaluating;
  }

  private revisionIcon(kind: GateDelayRevisionKind): string {
    if (kind === "confirmed") return "badge-check";
    if (kind === "resolved" || kind === "restored") return "shield-check";
    if (kind === "withdrawn") return "undo-2";
    return "scan-search";
  }

  private revisionLabel(kind: GateDelayRevisionKind): string {
    const t = this.options.translations;
    if (kind === "confirmed") return t.gateDelayRevisionConfirmed;
    if (kind === "resolved") return t.gateDelayRevisionResolved;
    if (kind === "restored") return t.gateDelayRevisionRestored;
    if (kind === "withdrawn") return t.gateDelayRevisionWithdrawn;
    return t.gateDelayRevisionEvaluation;
  }

  private actualEventLabel(kind: GateActualEvent["kind"]): string {
    const t = this.options.translations;
    if (kind === "reopened") return t.gateActualReopened;
    if (kind === "corrected") return t.gateActualCorrected;
    if (kind === "launch") return t.gateActualLaunch;
    if (kind === "launch-corrected") return t.gateActualLaunchCorrected;
    return t.gateActualPassed;
  }

  private changeSourceLabel(source: GateDateChangeSource): string {
    const t = this.options.translations;
    if (source === "manual") return t.gateDelayChangeManual;
    if (source === "linked") return t.gateDelayChangeLinked;
    return t.gateDelayChangeSystem;
  }

  private formatTimestamp(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat(undefined, {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        }).format(date);
  }

  private revisionWithdrawnAt(revision: GateDelayRevision): string | undefined {
    if (revision.withdrawnAt) return revision.withdrawnAt;
    return this.delay?.revisions.find((candidate) =>
      candidate.kind === "withdrawn" && candidate.targetRevisionId === revision.id
    )?.createdAt;
  }
}
