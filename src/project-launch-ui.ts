import { Modal, type App } from "obsidian";
import { projectLaunchState, type LaunchCommand, type LaunchContext, type LaunchDecision, type LaunchRejection } from "./domain/project-launch";
import type { ProjectRecord } from "./model";
import type { Translations } from "./i18n";

export type LaunchFeedback = "confirmed" | "corrected" | "revoked";

export interface ProjectLaunchUIOptions {
  app: App;
  project: ProjectRecord;
  translations: Translations;
  showOverview(): void;
  context(): LaunchContext;
  apply(command: LaunchCommand): Promise<LaunchDecision>;
  navigate(reason: LaunchRejection): void;
  onApplied(feedback: LaunchFeedback): void;
}

export function launchRejectionText(reason: LaunchRejection, t: Translations): string {
  switch (reason) {
    case "schedule-invalid": return t.launchBlockSchedule;
    case "acceptance-pending": return t.launchBlockAcceptance;
    case "delay-draft-pending": return t.launchBlockDraft;
    case "invalid-date": return t.gateLaunchDateInvalid;
    case "reason-required": return t.gateDelayReasonRequired;
    case "already-launched": return t.launchBlockAlready;
    case "not-launched": return t.launchBlockMissing;
    case "history-incomplete": return t.launchBlockHistory;
  }
}

function action(root: HTMLElement, text: string, name: string, run: () => void): HTMLButtonElement {
  const button = root.createEl("button", { text, cls: `pmi-launch-${name}`, attr: { type: "button" } });
  button.addEventListener("click", run);
  return button;
}

function seal(root: HTMLElement): void {
  const svg = root.createSvg("svg");
  svg.setAttribute("viewBox", "0 0 80 80");
  svg.setAttribute("class", "pmi-launch-seal");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of [
    ["circle", { cx: "40", cy: "40", r: "38", class: "pmi-launch-rim" }],
    ["circle", { cx: "40", cy: "40", r: "30", class: "pmi-launch-ring", transform: "rotate(-90 40 40)" }],
    ["path", { d: "M25 40 35 50 55 30", class: "pmi-launch-tick" }]
  ] as const) {
    const shape = root.ownerDocument.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, value);
    svg.append(shape);
  }
  root.append(svg);
}

export function renderProjectLaunch(root: HTMLElement, options: ProjectLaunchUIOptions, feedback?: LaunchFeedback): void {
  const context = options.context();
  const state = projectLaunchState(context);
  const t = options.translations;
  const section = root.createDiv({
    cls: `pmi-launch-panel is-${state.state}${feedback === "confirmed" ? " is-celebrating" : ""}`,
    attr: { "data-launch-project": options.project.id }
  });
  const result = section.createDiv("pmi-launch-result");
  const heading = result.createDiv("pmi-launch-heading");
  if (state.date) seal(heading);
  const copy = heading.createDiv("pmi-launch-heading-copy");
  copy.createEl("h3", { text: state.date ? t.launchSuccess : state.blocker
    ? launchRejectionText(state.blocker, t) : t.launchReady });
  copy.createEl("p", { text: state.date ? options.project.title : t.launchConfirmDescription });
  const dates = result.createDiv("pmi-launch-dates");
  const fields: Array<[string, string | null]> = state.date ? [
    [t.gateLaunchDate, state.date],
    [t.launchFromBaseline, state.baselineVariance === null ? null : t.launchVariance(state.baselineVariance, state.includeWeekends)],
    [t.launchFromForecast, state.forecastVariance === null ? null : t.launchVariance(state.forecastVariance, state.includeWeekends)]
  ] : [[t.gateBaselineTab, state.baselineDate], [t.gateDelayConfirmed, state.forecastDate]];
  for (const [label, value] of fields) {
    if (!value) continue;
    const field = dates.createDiv();
    field.createEl("small", { text: label });
    field.createEl("strong", { text: value });
  }
  if (state.date && state.openTaskCount > 0) {
    section.createEl("p", { cls: "pmi-launch-warning", text: t.launchAfterWork(state.openTaskCount) });
  }
  const open = (kind: LaunchCommand["kind"]): void => { new LaunchConfirmModal(options, kind).open(); };
  if (!state.date) {
    const actions = result.createDiv("pmi-launch-actions");
    if (state.blocker) {
      const blocker = state.blocker;
      action(actions, blocker === "acceptance-pending" ? t.launchViewAcceptance
        : blocker === "delay-draft-pending" ? t.launchViewDelay : t.gateEditorTitle,
      "resolve", () => options.navigate(blocker));
    } else {
      action(actions, t.launchConfirm, "confirm", () => open("confirm"));
    }
  }
  const history = section.createEl("details", { cls: "pmi-launch-history" });
  history.createEl("summary", { text: t.launchRecord, cls: "pmi-launch-record" });
  const events = [...(context.actuals?.events ?? [])].filter((event) => event.gateId === "launch").reverse();
  if (!events.length) history.createEl("p", { text: t.launchHistoryEmpty });
  for (const event of events) {
    const entry = history.createDiv("pmi-launch-history-entry");
    entry.createEl("strong", { text: event.kind === "launch-revoked" ? t.launchRevoked
      : event.kind === "launch-corrected" ? t.launchCorrected : t.launchConfirm });
    const timestamp = new Date(event.createdAt);
    entry.createEl("time", {
      text: Number.isFinite(timestamp.getTime())
        ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp)
        : event.createdAt,
      attr: { datetime: event.createdAt }
    });
    entry.createEl("p", { text: [event.previousDate, event.date].filter(Boolean).join(" → ") });
    if (event.reason) entry.createEl("p", { text: event.reason });
  }
  if (state.date) {
    const menu = section.createEl("details", { cls: "pmi-launch-management" });
    const summary = menu.createEl("summary", { text: t.launchManage });
    menu.createEl("p", { cls: "pmi-launch-management-help", text: t.launchManageHelp });
    const items = menu.createDiv("pmi-launch-management-items");
    for (const kind of ["correct", "revoke"] as const) {
      action(items, kind === "correct" ? t.launchCorrect : t.launchRevoke, kind, () => {
        menu.open = false;
        summary.focus();
        open(kind);
      });
    }
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menu.open) {
        menu.open = false;
        summary.focus();
        event.preventDefault();
        event.stopPropagation();
      }
    });
  }
  const announcement = section.createDiv({ cls: "pmi-sr-only", attr: { role: "status", "aria-live": "polite" } });
  if (feedback) {
    window.setTimeout(() => {
      if (!section.isConnected) return;
      announcement.setText(feedback === "confirmed" ? t.launchSaved(options.project.title, state.date ?? "")
        : feedback === "corrected" ? t.launchCorrected : t.launchRevoked);
      section.querySelector<HTMLElement>(state.date ? ".pmi-launch-record" : ".pmi-launch-confirm, .pmi-launch-resolve")?.focus({ preventScroll: true });
    }, 0);
  }
}

export class LaunchConfirmModal extends Modal {
  private saving = false;
  private readonly origin: HTMLElement | null;

  constructor(private readonly options: ProjectLaunchUIOptions, private readonly kind: LaunchCommand["kind"]) {
    super(options.app);
    this.origin = activeDocument.activeElement instanceof HTMLElement ? activeDocument.activeElement : null;
  }

  close(): void { if (!this.saving) super.close(); }

  onOpen(): void {
    const t = this.options.translations;
    const context = this.options.context();
    const state = projectLaunchState(context);
    const title = this.kind === "confirm" ? t.launchConfirm : this.kind === "correct" ? t.launchCorrect : t.launchRevoke;
    this.modalEl.addClass("pmi-launch-confirm-modal");
    this.titleEl.setText(title);
    this.contentEl.createEl("p", { cls: "pmi-launch-project", text: this.options.project.title });
    this.contentEl.createEl("p", { text: this.kind === "confirm" ? t.launchConfirmDescription
      : this.kind === "correct" ? t.launchCorrectDescription : t.launchRevokeDescription });
    const form = this.contentEl.createEl("form", { cls: "pmi-launch-form" });
    form.noValidate = true;
    let date: HTMLInputElement | undefined;
    let reason: HTMLTextAreaElement | undefined;
    if (this.kind !== "revoke") {
      const facts = form.createDiv("pmi-launch-dates");
      for (const [label, value] of [[t.acceptanceGateLabel, state.acceptanceDate], [t.gateBaselineTab, state.baselineDate], [t.gateDelayConfirmed, state.forecastDate]]) {
        if (!label || !value) continue;
        const field = facts.createDiv(); field.createEl("small", { text: label }); field.createEl("strong", { text: value });
      }
      const label = form.createEl("label", { cls: "pmi-launch-field" });
      label.createSpan({ text: t.gateLaunchDate });
      date = label.createEl("input", { type: "date", value: state.date ?? context.today, attr: { max: context.today } });
      if (state.acceptanceDate) date.min = state.acceptanceDate;
      label.createEl("small", { text: state.acceptanceDate ? t.launchDateHelp(state.acceptanceDate, context.today) : t.launchAcceptanceUnknown });
    }
    if (this.kind !== "confirm") {
      const label = form.createEl("label", { cls: "pmi-launch-field" });
      label.createSpan({ text: t.gateDelayReason });
      reason = label.createEl("textarea", { attr: { rows: "3", maxlength: "1000" } });
    }
    const error = form.createDiv({ cls: "pmi-launch-error", attr: { role: "alert" } });
    const actions = form.createDiv("pmi-launch-actions");
    action(actions, t.cancel, "cancel", () => this.close());
    const submit = actions.createEl("button", { text: title, cls: "pmi-launch-submit", attr: { type: "submit" } });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.saving) return;
      const command: LaunchCommand = this.kind === "confirm" ? { kind: "confirm", date: date?.value ?? "" }
        : this.kind === "correct" ? { kind: "correct", date: date?.value ?? "", reason: reason?.value ?? "" }
          : { kind: "revoke", reason: reason?.value ?? "" };
      this.saving = true;
      form.setAttribute("aria-busy", "true");
      const controls = this.modalEl.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>("input, button, textarea");
      for (const control of controls) control.disabled = true;
      submit.setText(t.launchSaving);
      error.empty();
      void (async () => {
        try {
          const decision = await this.options.apply(command);
          if (decision.kind === "rejected") {
            error.setText(launchRejectionText(decision.reason, t));
          } else if (decision.kind === "unchanged") {
            error.setText(t.launchUnchanged);
          } else {
            this.saving = false;
            this.close();
            this.options.onApplied(decision.feedback);
            return;
          }
        } catch {
          error.setText(t.launchSaveFailed);
        } finally {
          this.saving = false;
          form.removeAttribute("aria-busy");
          for (const control of controls) control.disabled = false;
          submit.setText(title);
        }
        if (error.isConnected) submit.focus();
      })();
    });
    window.setTimeout(() => (date ?? reason ?? submit).focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
    if (this.origin?.isConnected) this.origin.focus({ preventScroll: true });
  }
}

export class ProjectLaunchOverviewModal extends Modal {
  constructor(private readonly options: ProjectLaunchUIOptions) { super(options.app); }
  onOpen(): void {
    this.modalEl.addClass("pmi-launch-overview-modal");
    this.titleEl.setText(`${this.options.translations.launchPanelTitle} · ${this.options.project.title}`);
    this.refresh();
  }
  refresh(feedback?: LaunchFeedback): void {
    this.contentEl.empty();
    renderProjectLaunch(this.contentEl, { ...this.options, onApplied: (result) => this.refresh(result) }, feedback);
  }
  onClose(): void { this.contentEl.empty(); }
}
