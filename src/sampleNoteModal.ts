import { ButtonComponent, Modal } from "obsidian";
import type FlowStatePlugin from "./main";

/**
 * Post-sign-in choice: add the sample note (the handwritten welcome letter,
 * transcribed, with the original PDF attached) to the vault, or skip and see
 * an ephemeral preview instead. This modal IS the permission ask — the plugin
 * only writes the sample files after an explicit yes.
 *
 * ⚠️ User-facing copy — follow the Flowstate voice guides before editing.
 */
export class SampleNoteModal extends Modal {
  private chosen = false;

  constructor(
    plugin: FlowStatePlugin,
    private onChoice: (addToVault: boolean) => Promise<void> | void
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.modalEl.addClass("fs-ob-modal");
    const { titleEl, contentEl } = this;
    titleEl.setText("Wanna start with a sample note?");

    contentEl.createEl("p", {
      text: "We (Raj and Rob, makers of Flowstate) wrote you a welcome note (by hand, of course). Click below, and we'll drop it into your vault to show how Flowstate works.",
      cls: "fs-ob-tagline",
    });
    contentEl.createEl("p", {
      text: "This will create two small files in your vault. Delete them anytime. Or you can skip, and we'll show you a preview instead. Nothing gets written.",
      cls: "fs-sample-fineprint",
    });

    const row = contentEl.createDiv({ cls: "fs-sample-buttons" });
    const skipBtn = new ButtonComponent(row);
    skipBtn.setButtonText("Just show a preview");
    skipBtn.onClick(() => this.choose(false));
    const addBtn = new ButtonComponent(row);
    addBtn.setCta().setButtonText("Add the sample note!");
    addBtn.onClick(() => this.choose(true));
  }

  private choose(addToVault: boolean): void {
    if (this.chosen) return;
    this.chosen = true;
    this.close();
    void this.onChoice(addToVault);
  }

  onClose(): void {
    this.contentEl.empty();
    // Closing without picking (X / Esc) falls back to the no-write preview.
    if (!this.chosen) {
      this.chosen = true;
      void this.onChoice(false);
    }
  }
}
