import { ItemView, MarkdownRenderer, WorkspaceLeaf, type ViewStateResult } from "obsidian";
import { welcomeNoteContent } from "./firstRun";

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

  constructor(leaf: WorkspaceLeaf) {
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
    const s = (state ?? {}) as { flowEmail?: unknown };
    this.flowEmail = typeof s.flowEmail === "string" && s.flowEmail ? s.flowEmail : null;
    await this.render();
    return super.setState(state, result);
  }

  getState(): Record<string, unknown> {
    return { flowEmail: this.flowEmail };
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  private async render(): Promise<void> {
    const el = this.contentEl;
    el.empty();
    el.addClass("fs-welcome-view");
    const inner = el.createDiv({ cls: "fs-welcome-inner markdown-rendered" });
    await MarkdownRenderer.render(this.app, welcomeNoteContent(this.flowEmail), inner, "", this);
  }
}
