import { ButtonComponent, Modal, setIcon, type App } from "obsidian";

interface ConfirmActionModalOptions {
  title: string;
  message: string;
  cancel: string;
  confirm: string;
  icon?: string;
  destructive?: boolean;
  onConfirm(): void;
  onCancel?(): void;
}

export class ConfirmActionModal extends Modal {
  private confirmed = false;
  constructor(app: App, private readonly options: ConfirmActionModalOptions) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("pmi-confirm-action-modal");
    if (this.options.destructive) this.modalEl.addClass("is-destructive");
    this.titleEl.setText(this.options.title);
    const summary = this.contentEl.createDiv("pmi-confirm-action-summary");
    if (this.options.destructive) {
      const signal = summary.createSpan("pmi-confirm-action-signal");
      setIcon(signal, this.options.icon ?? "pencil-off");
    }
    summary.createEl("p", { text: this.options.message });
    const actions = this.contentEl.createDiv("pmi-confirm-action-actions");
    const cancel = new ButtonComponent(actions)
      .setButtonText(this.options.cancel)
      .onClick(() => this.close());
    cancel.buttonEl.addClass("pmi-confirm-action-cancel");
    const confirm = new ButtonComponent(actions).setButtonText(this.options.confirm);
    confirm.buttonEl.addClass("pmi-confirm-action-confirm");
    if (this.options.destructive) confirm.buttonEl.addClass("is-destructive");
    else confirm.setCta();
    confirm.onClick(() => {
      this.confirmed = true;
      this.close();
      this.options.onConfirm();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.confirmed) this.options.onCancel?.();
  }
}
