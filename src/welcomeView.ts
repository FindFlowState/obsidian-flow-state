import { ItemView, MarkdownRenderer, Notice, WorkspaceLeaf, type ViewStateResult } from "obsidian";
import { welcomeNoteContent, installSampleNote, SAMPLE_ACTION_HREF, UPLOAD_ACTION_HREF, SETTINGS_ACTION_HREF, BOTTOM_CTA_HREF, SUPPORT_EMAIL, SAMPLE_CTA, GET_STARTED_CTA, UPLOAD_CTA } from "./firstRun";
import { openUploadModal } from "./uploadModal";
import { getSupabase } from "./supabase";
import type FlowStatePlugin from "./main";

export const WELCOME_VIEW_TYPE = "flow-state-welcome";

/**
 * The post-sign-in welcome screen. Opens in a normal tab and renders the
 * welcome markdown with Obsidian's own renderer, so it reads exactly like a
 * delivered note — but it's a view, not a file: nothing is written to the
 * user's vault. The user's flow email arrives via view state so it survives
 * workspace restores.
 */
export class WelcomeView extends ItemView {
  private flowEmail: string | null = null;
  private sampleAdded = false;
  private adding = false;
  private samplePath: string | null = null;
  // Checked live on every render (not view state): the same open tab flips
  // from the signed-out variant to the signed-in one after the user signs in.
  private signedIn = false;

  constructor(leaf: WorkspaceLeaf, private plugin: FlowStatePlugin) {
    super(leaf);
  }

  getViewType(): string {
    return WELCOME_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Welcome to Flowstate";
  }

  getIcon(): string {
    return "feather";
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = (state ?? {}) as { flowEmail?: unknown; sampleAdded?: unknown };
    this.flowEmail = typeof s.flowEmail === "string" && s.flowEmail ? s.flowEmail : null;
    this.sampleAdded = s.sampleAdded === true;
    await this.render();
    return super.setState(state, result);
  }

  getState(): Record<string, unknown> {
    return { flowEmail: this.flowEmail, sampleAdded: this.sampleAdded };
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  private async render(): Promise<void> {
    try {
      const supabase = getSupabase(this.plugin.settings);
      const { data: { session } } = await supabase.auth.getSession();
      this.signedIn = !!session;
    } catch {
      this.signedIn = false;
    }
    const el = this.contentEl;
    el.empty();
    el.addClass("fs-welcome-view");
    const inner = el.createDiv({ cls: "fs-welcome-inner markdown-rendered" });
    await MarkdownRenderer.render(
      this.app,
      welcomeNoteContent(this.flowEmail, this.sampleAdded, this.signedIn),
      inner,
      "",
      this
    );
    this.renderSampleCta(inner);
    this.renderBottomCta(inner);
    this.wireUploadLink(inner);
    this.wireSettingsLink(inner);
    this.wireEmailCopy(inner);
  }

  /** "Flowstate Settings" opens this plugin's settings tab directly. */
  private wireSettingsLink(inner: HTMLElement): void {
    const link = inner.querySelector<HTMLAnchorElement>(`a[href="${SETTINGS_ACTION_HREF}"]`);
    if (!link) return;
    this.registerDomEvent(link, "click", (evt: MouseEvent) => {
      evt.preventDefault();
      void (async () => {
        try {
          const setting = (this.app as unknown as {
            setting: { open(): Promise<void>; openTabById(id: string): void };
          }).setting;
          await setting.open();
          setting.openTabById(this.plugin.manifest.id);
        } catch {
          new Notice("Flowstate: open Settings → Flowstate");
        }
      })();
    });
  }

  /**
   * "Upload a file" opens the plugin's upload modal rather than navigating.
   * Signed-out readers land in the sign-in modal instead — uploading needs an
   * account, and the sign-in door is more useful than an error.
   */
  private wireUploadLink(inner: HTMLElement): void {
    const link = inner.querySelector<HTMLAnchorElement>(`a[href="${UPLOAD_ACTION_HREF}"]`);
    if (!link) return;
    this.registerDomEvent(link, "click", (evt: MouseEvent) => {
      evt.preventDefault();
      if (this.signedIn) openUploadModal(this.app, this.plugin);
      else this.plugin.openSignIn();
    });
  }

  /**
   * Swap the bottom CTA placeholder (after Credits, before the sign-off) for
   * a card matching the signed-in state: the sign-in door when signed out,
   * the first real upload when signed in. Same fallback contract as the
   * sample CTA: if the placeholder is missing, the plain link still works via
   * wireUploadLink / nothing is lost.
   */
  private renderBottomCta(inner: HTMLElement): void {
    const link = inner.querySelector<HTMLAnchorElement>(`a[href="${BOTTOM_CTA_HREF}"]`);
    if (!link) return;
    const cta = this.signedIn ? UPLOAD_CTA : GET_STARTED_CTA;
    const host = link.closest("p") ?? link;
    const card = createDiv({ cls: "fs-welcome-cta" });
    card.createDiv({ cls: "fs-welcome-cta-body", text: cta.body });
    const btn = card.createEl("button", { cls: "fs-welcome-cta-btn mod-cta", text: cta.button });
    host.replaceWith(card);
    this.registerDomEvent(btn, "click", (evt: MouseEvent) => {
      evt.preventDefault();
      if (this.signedIn) openUploadModal(this.app, this.plugin);
      else this.plugin.openSignIn();
    });
  }

  /**
   * Swap the placeholder link for a real CTA card, under the "Try it now"
   * heading. Falls back to leaving the plain link alone if the placeholder
   * can't be found, so the action is never lost.
   */
  private renderSampleCta(inner: HTMLElement): void {
    const link = inner.querySelector<HTMLAnchorElement>(`a[href="${SAMPLE_ACTION_HREF}"]`);
    if (!link) return;
    const host = link.closest("p") ?? link;
    const card = createDiv({ cls: "fs-welcome-cta" });
    card.createDiv({ cls: "fs-welcome-cta-body", text: this.sampleAdded ? SAMPLE_CTA.doneBody : SAMPLE_CTA.body });
    const btn = card.createEl("button", {
      cls: "fs-welcome-cta-btn mod-cta",
      text: this.sampleAdded ? SAMPLE_CTA.doneButton : SAMPLE_CTA.button,
    });
    host.replaceWith(card);

    this.registerDomEvent(btn, "click", (evt: MouseEvent) => {
      evt.preventDefault();
      if (this.sampleAdded) {
        if (this.samplePath) void this.app.workspace.openLinkText(this.samplePath, "", true);
        return;
      }
      // Guard against a double click writing a second copy of both files
      if (this.adding) return;
      this.adding = true;
      btn.disabled = true;
      void (async () => {
        try {
          const notePath = await installSampleNote(this.app);
          this.samplePath = notePath;
          this.sampleAdded = true;
          // Re-render first so the card shows its done state even though the
          // note takes focus in its own tab
          await this.render();
          await this.app.workspace.openLinkText(notePath, "", true);
        } catch (e) {
          btn.disabled = false;
          new Notice(`Flowstate: couldn't add the sample note — ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          this.adding = false;
        }
      })();
    });
  }

  /**
   * Addresses on this screen are click-to-copy rather than something to select
   * by hand (and rather than mailto:, which hijacks the user into a mail app).
   * Covers the user's own flow address and our support address.
   */
  private wireEmailCopy(inner: HTMLElement): void {
    const addresses = [this.flowEmail, SUPPORT_EMAIL].filter((a): a is string => !!a);
    if (!addresses.length) return;
    for (const code of Array.from(inner.querySelectorAll("code"))) {
      const text = code.textContent?.trim();
      if (!text || !addresses.includes(text)) continue;
      code.addClass("fs-welcome-email");
      code.setAttribute("aria-label", "Copy to clipboard");
      this.registerDomEvent(code, "click", () => {
        void navigator.clipboard.writeText(text).then(
          () => new Notice("Flowstate: Address copied"),
          () => new Notice("Flowstate: couldn't copy — select and copy it instead")
        );
      });
    }
  }
}
