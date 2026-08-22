import { ButtonComponent, Modal, type App } from "obsidian";

interface ConfirmActionModalOptions {
  title: string;
  message: string;
  cancel: string;
  confirm: string;
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
    this.titleEl.setText(this.options.title);
    this.contentEl.createEl("p", { text: this.options.message });
    const actions = this.contentEl.createDiv("pmi-confirm-action-actions");
    const cancel = new ButtonComponent(actions)
      .setButtonText(this.options.cancel)
      .onClick(() => this.close());
    cancel.buttonEl.addClass("pmi-confirm-action-cancel");
    const confirm = new ButtonComponent(actions).setButtonText(this.options.confirm);
    confirm.buttonEl.addClass("pmi-confirm-action-confirm");
    if (this.options.destructive) confirm.buttonEl.addClass("mod-warning");
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
