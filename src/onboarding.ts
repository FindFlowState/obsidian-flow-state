import { ButtonComponent, Modal } from "obsidian";
import type FlowStatePlugin from "./main";
import { openWelcomeScreenNow } from "./firstRun";

/**
 * First-run onboarding modal, shown on plugin load while no account is signed
 * in (until dismissed once). Explains the capture → transcribe → vault
 * pipeline, then offers two doors: "Get started" opens the sign-in modal
 * (see signInModal.ts), "Learn more" opens the welcome screen so the user can
 * read what Flowstate does before handing over an email.
 *
 * ⚠️ User-facing copy — follow the Flowstate voice guides before editing.
 */
export class OnboardingModal extends Modal {
  private plugin: FlowStatePlugin;
  private completed = false;
  // Set when a button routed the user onward (sign-in modal or welcome
  // screen), so onClose doesn't also fire the dev-replay tail underneath the
  // screen the user just chose.
  private routedOnward = false;

  constructor(plugin: FlowStatePlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  /** Called when sign-in completed elsewhere (magic link deep link). */
  markCompleted(): void {
    this.completed = true;
  }

  onOpen(): void {
    this.modalEl.addClass("fs-ob-modal");
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
    if (this.plugin.onboardingModal === this) this.plugin.onboardingModal = null;
    // One showing is enough: don't nag on every launch. The settings tab keeps
    // sign-up available (the onboarding command is dev-only).
    if (!this.completed && !this.plugin.settings.onboardingDismissed) {
      this.plugin.settings.onboardingDismissed = true;
      void this.plugin.saveData(this.plugin.settings);
    }
    // Dev replay by an already-signed-in admin: no sign-in fires here to carry
    // the sequence on, so continue into the second half from the close instead.
    // A no-op when sign-in already ran it, or while still signed out.
    if (!this.completed && !this.routedOnward) void this.plugin.runOnboardingTail();
  }

  private render(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    titleEl.setText("Flowstate");

    // No link on "Flowstate" here: "Learn more" below is the door to the full
    // story, so the tagline shouldn't smuggle the reader out to the website.
    contentEl.createEl("p", {
      cls: "fs-ob-tagline",
      text: "Flowstate turns handwriting and voice into text files, and saves them automatically to your Vault.",
    });

    const steps: Array<{ title: string; body: string }> = [
      { title: "Write by hand, or record your voice", body: "Use pen & paper, e-ink tablets, or talk out loud" },
      { title: "Share it with Flowstate", body: "Upload a file, send in an email, or use the Flowstate app" },
      { title: "See notes saved to your Vault, automatically", body: "Flowstate transcribes and saves them exactly where you want" },
    ];
    const list = contentEl.createDiv({ cls: "fs-ob-steps" });
    steps.forEach((s, i) => {
      const row = list.createDiv({ cls: "fs-ob-step" });
      row.createDiv({ text: String(i + 1), cls: "fs-ob-step-num" });
      const txt = row.createDiv({ cls: "fs-ob-step-text" });
      txt.createDiv({ text: s.title, cls: "fs-ob-step-title" });
      txt.createDiv({ text: s.body, cls: "fs-ob-step-body" });
    });

    const row = contentEl.createDiv({ cls: "fs-ob-btn-row" });
    const learn = new ButtonComponent(row);
    learn.setButtonText("Learn more");
    learn.onClick(() => {
      this.routedOnward = true;
      this.close();
      // The welcome screen opens in a workspace tab, so get the settings pane
      // out of the way if it happens to be open behind this modal.
      try {
        (this.app as unknown as { setting: { close(): void } }).setting.close();
      } catch {
        // Best-effort: the undocumented settings API moved — the tab still opens.
      }
      void openWelcomeScreenNow(this.plugin);
    });
    const cta = new ButtonComponent(row);
    cta.setCta().setButtonText("Get started");
    cta.onClick(() => {
      this.routedOnward = true;
      this.close();
      this.plugin.openSignIn();
    });
  }
}
