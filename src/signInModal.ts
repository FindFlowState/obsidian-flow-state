import { ButtonComponent, Modal, Notice } from "obsidian";
import type FlowStatePlugin from "./main";
import { getSupabase, sendMagicLink, verifyEmailOtp } from "./supabase";
import { errorMessage } from "./logger";

/**
 * Email sign-in / sign-up modal, reached from the intro modal's "Get started"
 * button and the welcome screen's bottom CTA. We email a code, the user types
 * it here. Clicking the magic link in the same email also works — the
 * deep-link handler completes sign-in and closes this modal (via
 * plugin.signInModal).
 *
 * ⚠️ User-facing copy — follow the Flowstate voice guides before editing.
 */
export class SignInModal extends Modal {
  private plugin: FlowStatePlugin;
  private email = "";
  private step: "email" | "code" = "email";
  private completed = false;
  private busy = false;
  // Reached from the intro modal (rather than the welcome screen): closing
  // without signing in goes back to the intro, so the X is a "back", not a
  // dead end.
  private returnToIntro: boolean;

  constructor(plugin: FlowStatePlugin, opts: { returnToIntro?: boolean } = {}) {
    super(plugin.app);
    this.plugin = plugin;
    this.returnToIntro = opts.returnToIntro === true;
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
    if (this.plugin.signInModal === this) this.plugin.signInModal = null;
    if (this.completed) return;
    if (this.returnToIntro) {
      // Backed out of the intro's sign-in path: resurface the intro so its
      // two doors are still on the table. (Its own close then runs the tail.)
      this.plugin.openOnboarding();
      return;
    }
    // Dev replay by an already-signed-in admin: no sign-in fires here to carry
    // the sequence on, so continue into the second half from the close instead.
    // A no-op when sign-in already ran it, or while still signed out.
    void this.plugin.runOnboardingTail();
  }

  private render(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    if (this.step === "email") this.renderEmail(titleEl, contentEl);
    else this.renderCode(titleEl, contentEl);
  }

  private renderEmail(titleEl: HTMLElement, contentEl: HTMLElement): void {
    titleEl.setText("Get started");

    contentEl.createEl("p", {
      text: "Sign into your Flowstate account or create one.",
      cls: "fs-ob-tagline",
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
    cta.setCta().setButtonText("Next");
    cta.onClick(() => void this.sendCode());
    window.setTimeout(() => input.focus(), 0);
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
      this.step = "email";
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
