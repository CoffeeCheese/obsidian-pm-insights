import { ButtonComponent, Modal, setIcon, type App } from "obsidian";
import { validateGateSchedule } from "./domain/gate-schedule";
import type { Translations } from "./i18n";
import type {
  DeliveryStageSettings,
  ProjectGateSchedule,
  ProjectRecord
} from "./model";
import { ConfirmActionModal } from "./confirm-action-modal";

interface ProjectGatesModalOptions {
  project: ProjectRecord;
  stages: DeliveryStageSettings[];
  stageName(stage: DeliveryStageSettings): string;
  schedule: ProjectGateSchedule | undefined;
  translations: Translations;
  save(schedule: ProjectGateSchedule): Promise<void>;
}

export class ProjectGatesModal extends Modal {
  private draft: ProjectGateSchedule;
  private dirty = false;
  private allowClose = false;
  private confirmationOpen = false;
  private saveButton: HTMLButtonElement | null = null;
  private validationEl: HTMLElement | null = null;

  constructor(app: App, private readonly options: ProjectGatesModalOptions) {
    super(app);
    this.draft = options.schedule
      ? structuredClone(options.schedule)
      : { startDate: "", stageGates: {}, acceptanceGate: "", launchDate: "" };
  }

  onOpen(): void {
    const { project, translations: t } = this.options;
    this.modalEl.addClass("pmi-project-gates-modal");
    const lead = this.contentEl.createDiv("pmi-gate-editor-lead");
    const signal = lead.createSpan("pmi-gate-editor-signal");
    setIcon(signal, "milestone");
    const copy = lead.createDiv("pmi-gate-editor-copy");
    copy.createEl("h2", { text: t.gateEditorTitle });
    copy.createEl("strong", { text: `${project.icon} ${project.title}` });
    copy.createEl("p", { text: t.gateEditorDesc });

    const timeline = this.contentEl.createDiv("pmi-gate-editor-timeline");
    this.dateField(timeline, "flag", t.projectStartDate, this.draft.startDate, (value) => {
      this.draft.startDate = value;
    });
    for (const [index, stage] of this.options.stages.entries()) {
      this.dateField(
        timeline,
        "diamond",
        t.stageGateDate(this.options.stageName(stage)),
        this.draft.stageGates[stage.id] ?? "",
        (value) => {
          this.draft.stageGates[stage.id] = value;
        },
        stage.id,
        index
      );
    }
    this.dateField(
      timeline,
      "badge-check",
      t.acceptanceGateDate,
      this.draft.acceptanceGate,
      (value) => {
        this.draft.acceptanceGate = value;
      },
      "acceptance"
    );
    this.dateField(timeline, "rocket", t.launchReminderDate, this.draft.launchDate, (value) => {
      this.draft.launchDate = value;
    }, "launch");

    this.validationEl = this.contentEl.createDiv({
      cls: "pmi-gate-editor-validation",
      attr: { role: "status", "aria-live": "polite" }
    });
    const footer = this.contentEl.createDiv("pmi-gate-editor-footer");
    const cancel = new ButtonComponent(footer).setButtonText(t.cancel).onClick(() => this.close());
    cancel.buttonEl.addClass("pmi-gate-editor-cancel");
    const save = new ButtonComponent(footer).setButtonText(t.saveGates).setCta();
    save.buttonEl.addClass("pmi-gate-editor-save");
    this.saveButton = save.buttonEl;
    save.onClick(() => void this.save());
    this.updateValidation();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  close(): void {
    if (!this.allowClose && this.dirty) {
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
          this.dirty = false;
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

  private dateField(
    root: HTMLElement,
    icon: string,
    label: string,
    value: string,
    update: (value: string) => void,
    gateId = "start",
    stageIndex?: number
  ): void {
    const row = root.createDiv("pmi-gate-editor-row");
    row.dataset.gateId = gateId;
    if (stageIndex !== undefined) row.dataset.stageIndex = String(stageIndex);
    const node = row.createSpan("pmi-gate-editor-node");
    setIcon(node, icon);
    const field = row.createEl("label", { cls: "pmi-gate-editor-field" });
    field.createSpan({ text: label });
    const input = field.createEl("input", {
      type: "date",
      value,
      attr: { "aria-label": label }
    });
    input.addEventListener("input", () => {
      update(input.value);
      this.dirty = true;
      this.updateValidation();
    });
  }

  private updateValidation(): void {
    const { translations: t, stages } = this.options;
    const result = validateGateSchedule(this.draft, stages.map((stage) => stage.id));
    if (this.saveButton) this.saveButton.disabled = !result.valid;
    this.validationEl?.setText(
      result.valid
        ? ""
        : result.missing.length > 0
          ? t.gateDatesRequired
          : result.invalid.length > 0
            ? t.gateDatesInvalid
            : t.gateDatesOrderInvalid
    );
  }

  private async save(): Promise<void> {
    const result = validateGateSchedule(
      this.draft,
      this.options.stages.map((stage) => stage.id)
    );
    if (!result.valid) return;
    if (this.saveButton) this.saveButton.disabled = true;
    await this.options.save(structuredClone(this.draft));
    this.dirty = false;
    this.allowClose = true;
    super.close();
  }
}
