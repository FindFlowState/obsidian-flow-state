import { App, Modal, Setting } from "obsidian";

export interface ConfirmOptions {
  title: string;
  message: string;
  cta?: string;
  warning?: boolean;
}

/** Promise-based confirmation dialog using an Obsidian Modal (replaces window.confirm). */
export function confirmModal(app: App, opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new Modal(app);
    let confirmed = false;
    modal.titleEl.setText(opts.title);
    modal.contentEl.createEl("p", { text: opts.message });
    new Setting(modal.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => modal.close()))
      .addButton((b) => {
        b.setButtonText(opts.cta ?? "Confirm");
        if (opts.warning) b.setWarning();
        else b.setCta();
        b.onClick(() => {
          confirmed = true;
          modal.close();
        });
      });
    modal.onClose = () => resolve(confirmed);
    modal.open();
  });
}
