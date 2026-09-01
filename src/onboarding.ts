import { ButtonComponent, Modal, Notice } from "obsidian";
import type FlowStatePlugin from "./main";
import { getSupabase, sendMagicLink, verifyEmailOtp } from "./supabase";
import { errorMessage } from "./logger";

/**
 * First-run onboarding modal, shown on plugin load while no account is signed
 * in (until dismissed once). Explains the capture → transcribe → vault
 * pipeline and signs the user in without leaving Obsidian: we email a code,
 * they type it here. Clicking the magic link in the same email also works —
 * the deep-link handler completes sign-in and closes this modal.
 *
 * ⚠️ User-facing copy — follow the Flowstate voice guides before editing.
 */
export class OnboardingModal extends Modal {
  private plugin: FlowStatePlugin;
  private email = "";
  private step: "intro" | "code" = "intro";
  private completed = false;
  private busy = false;

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
    // One showing is enough: don't nag on every launch. The settings tab and
    // the "Get started" command keep sign-up available.
    if (!this.completed && !this.plugin.settings.onboardingDismissed) {
      this.plugin.settings.onboardingDismissed = true;
      void this.plugin.saveData(this.plugin.settings);
    }
  }

  private render(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    if (this.step === "intro") this.renderIntro(titleEl, contentEl);
    else this.renderCode(titleEl, contentEl);
  }

  private renderIntro(titleEl: HTMLElement, contentEl: HTMLElement): void {
    titleEl.setText("Your handwriting, transcribed into your vault");

    contentEl.createEl("p", {
      text: "Flowstate transcribes handwritten pages and voice memos and files them in Obsidian as clean, searchable markdown.",
      cls: "fs-ob-tagline",
    });

    const steps: Array<{ title: string; body: string }> = [
      { title: "Write or record", body: "On paper, an e-ink tablet, or out loud as a voice memo." },
      { title: "Capture it", body: "Snap it with the Flowstate app, or email it from your reMarkable, Boox, or Supernote." },
      { title: "It lands here", body: "Transcribed, formatted, and filed in your vault." },
    ];
    const list = contentEl.createDiv({ cls: "fs-ob-steps" });
    steps.forEach((s, i) => {
      const row = list.createDiv({ cls: "fs-ob-step" });
      row.createDiv({ text: String(i + 1), cls: "fs-ob-step-num" });
      const txt = row.createDiv({ cls: "fs-ob-step-text" });
      txt.createDiv({ text: s.title, cls: "fs-ob-step-title" });
      txt.createDiv({ text: s.body, cls: "fs-ob-step-body" });
    });

    contentEl.createEl("p", {
      text: "Your first 50 pages are free. No card, no catch. Top up your credits anytime.",
      cls: "fs-ob-credits",
    });

    const row = contentEl.createDiv({ cls: "fs-ob-email-row" });
    const input = row.createEl("input", {
      type: "email",
      placeholder: "you@example.com",
      cls: "fs-ob-email-input",
    });
    input.value = this.email;
    input.addEventListener("input", () => { this.email = input.value.trim(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); void this.sendCode(); }
    });
    const cta = new ButtonComponent(row);
    cta.setCta().setButtonText("Get started");
    cta.onClick(() => void this.sendCode());
    window.setTimeout(() => input.focus(), 0);

    const later = contentEl.createDiv({ cls: "fs-ob-later" });
    const link = later.createEl("a", { text: "Maybe later", cls: "fs-muted-link" });
    link.addEventListener("click", (e) => { e.preventDefault(); this.close(); });
  }

  private renderCode(titleEl: HTMLElement, contentEl: HTMLElement): void {
    titleEl.setText("Check your email");

    const p = contentEl.createEl("p", { cls: "fs-ob-tagline" });
    p.appendText("We sent a sign-in code to ");
    p.createEl("strong", { text: this.email });
    p.appendText(". Type it below, or click the link (just make sure if you click, it's on this device).");

    let code = "";
    const row = contentEl.createDiv({ cls: "fs-ob-email-row" });
    const input = row.createEl("input", {
      type: "text",
      placeholder: "6-digit code",
      cls: "fs-ob-code-input",
    });
    input.inputMode = "numeric";
    input.autocomplete = "one-time-code";
    input.addEventListener("input", () => { code = input.value.trim(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); void this.verify(code); }
    });
    const cta = new ButtonComponent(row);
    cta.setCta().setButtonText("Sign in");
    cta.onClick(() => void this.verify(code));
    window.setTimeout(() => input.focus(), 0);

    const links = contentEl.createDiv({ cls: "fs-ob-links" });
    const resend = links.createEl("a", { text: "Resend code", cls: "fs-muted-link" });
    resend.addEventListener("click", (e) => { e.preventDefault(); void this.sendCode(true); });
    const back = links.createEl("a", { text: "Use a different email", cls: "fs-muted-link" });
    back.addEventListener("click", (e) => {
      e.preventDefault();
      this.step = "intro";
      this.render();
    });
  }

  private async sendCode(isResend = false): Promise<void> {
    if (this.busy) return;
    if (!this.email || !this.email.includes("@")) {
      new Notice("Enter your email address first");
      return;
    }
    this.busy = true;
    try {
      const supabase = getSupabase(this.plugin.settings);
      await sendMagicLink(supabase, this.email, "obsidian://flow-state");
      if (isResend) {
        new Notice(`Code re-sent to ${this.email}`);
      } else {
        this.step = "code";
        this.render();
      }
    } catch (e: unknown) {
      new Notice(`Couldn't send the code: ${errorMessage(e)}`);
    } finally {
      this.busy = false;
    }
  }

  private async verify(code: string): Promise<void> {
    if (this.busy) return;
    if (!code) {
      new Notice("Enter the code from your email");
      return;
    }
    this.busy = true;
    try {
      const supabase = getSupabase(this.plugin.settings);
      await verifyEmailOtp(supabase, this.email, code);
      this.completed = true;
      new Notice("HUZZAH! Welcome to Flowstate!");
      this.close();
      await this.plugin.handleSignedIn();
    } catch (e: unknown) {
      new Notice(`That code didn't work: ${errorMessage(e)}`);
    } finally {
      this.busy = false;
    }
  }
}
