import { App, PluginSettingTab, Setting, Notice, ButtonComponent } from "obsidian";
import type FlowStatePlugin from "./main";
import type { Route } from "./types";
import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY } from "./config";
import { getSupabase, getCurrentSession, signOut as supaSignOut, sendMagicLink, verifyEmailOtp, listObsidianRoutes, listRecentJobs, deleteRoute, fetchRouteById, fetchUserCredits } from "./supabase";
import { formatRelativeTime } from "./time";
import { GetAppModal } from "./getAppModal";
import { openUploadModal } from "./uploadModal";
import { renderRouteEditor } from "./routeEditor";
import { errorMessage } from "./logger";
import { confirmModal } from "./confirmModal";

export type PluginSettings = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  // Cache entire Route rows keyed by id (includes destination_config JSON)
  routes?: Record<string, Route>;
  // Last known signed-in user id to filter cached routes without awaiting auth
  lastUserId?: string;
  // Supabase auth token storage, persisted in data.json so the session survives
  // plugin updates/reloads (Obsidian doesn't reliably persist localStorage,
  // especially on mobile). Backs the custom auth storage adapter in supabase.ts.
  authStore?: Record<string, string>;
  // First-run onboarding modal was shown (or dismissed) once already
  onboardingDismissed?: boolean;
  // Account ids that already went through first-sign-in starter setup
  starterSetupUsers?: string[];
  // The one-time "your first note just landed" notice was already shown
  firstSyncNoticeShown?: boolean;
};

export const DEFAULT_SETTINGS: PluginSettings = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  routes: {},
  lastUserId: "",
  authStore: {},
  onboardingDismissed: false,
  starterSetupUsers: [],
  firstSyncNoticeShown: false
};

export class FlowStateSettingTab extends PluginSettingTab {
  // undefined -> list view; null -> new project; Route -> edit existing
  private editingRoute: Route | null | undefined = undefined;
  // Email we sent a sign-in code to; non-null renders the "enter code" state
  private pendingOtpEmail: string | null = null;
  // Deferred project ID for deep link navigation
  private deferredProjectId: string | null = null;
  // Generation counter to cancel stale async renders
  private displayGeneration = 0;

  constructor(
    app: App,
    private plugin: FlowStatePlugin,
    private settings: PluginSettings,
    private onSave?: () => Promise<void>
  ) {
    super(app, plugin);
  }

  /** Set a project ID to navigate to when display() is called */
  setDeferredProject(projectId: string): void {
    this.deferredProjectId = projectId;
  }

  /** Open the project editor for a specific route (called from deep link handler) */
  openProjectEditor(route: Route | null): void {
    this.editingRoute = route;
    this.display();
  }

  /** Open the Add Project screen (called from deep link handler) */
  openNewProject(): void {
    this.editingRoute = null;
    this.display();
  }

  display(): void {
    const { containerEl } = this;
    // Increment generation to cancel any stale async renders from previous display() calls
    const generation = ++this.displayGeneration;

    // Handle deferred project navigation from deep link
    if (this.deferredProjectId) {
      const projectId = this.deferredProjectId;
      this.deferredProjectId = null; // Clear before async to prevent loops
      containerEl.empty(); // Clear existing content while loading

      void (async () => {
        try {
          const supabase = getSupabase(this.settings);
          const route = await fetchRouteById(supabase, projectId);
          // Bail out if a newer display() was called
          if (this.displayGeneration !== generation) return;
          if (route) {
            this.editingRoute = route;
            this.display(); // Re-render with the project editor
          } else {
            new Notice("Flow not found");
            this.display(); // Show normal list view
          }
        } catch (e: unknown) {
          // Bail out if a newer display() was called
          if (this.displayGeneration !== generation) return;
          console.error("Failed to load deferred project:", e);
          new Notice(`Failed to load Flow: ${errorMessage(e)}`);
          this.display(); // Show normal list view on error
        }
      })();
      return; // Don't render yet, wait for async fetch
    }

    containerEl.empty();

    // Flowstate title (plain text, styled like other plugins)
    containerEl.createEl("div", { text: "Flowstate", cls: "fs-settings-title" });

    // Intro text with Learn more link on same line
    const intro = containerEl.createEl("div", { cls: "fs-intro" });
    intro.appendText("Your handwriting and voice, transcribed and filed in Obsidian. ");
    intro.createEl("a", { text: "Learn more →", href: "https://seekflowstate.com", cls: "fs-muted-link" });

    // How it works bullets (will be hidden when signed in)
    const bulletsSection = containerEl.createDiv({ cls: "fs-onboarding-bullets" });
    const bulletList = bulletsSection.createEl("ul", { cls: "fs-onboarding-list" });

    // First bullet links "Flowstate app" to the website (which has the iOS/Android download links)
    const firstBullet = bulletList.createEl("li");
    firstBullet.appendText("Capture your handwriting or voice through the ");
    firstBullet.createEl("a", { text: "Flowstate app", href: "https://seekflowstate.com", cls: "fs-muted-link" });
    firstBullet.appendText(", or send an email from an e-ink tablet.");

    const bullets = [
      "Flowstate transcribes and formats automatically. You can also ask us for summaries, translations, poems, etc. Anything your heart desires.",
      "Plain text notes sync seamlessly to your vault. The original PDF or audio can be saved as an attachment.",
    ];
    for (const bullet of bullets) {
      bulletList.createEl("li", { text: bullet });
    }

    // Unified connect section: email/code entry when signed out, account row
    // when signed in. Placed inside a fixed wrapper so async rendering
    // preserves order.
    let emailValue = "";
    const authSection = containerEl.createDiv();
    const connectSetting = new Setting(authSection)
      .setName("Sign up or sign in");
    connectSetting.setDesc("Enter your email and we'll send you a sign-in code. New accounts start with 50 free pages.");

    void (async () => {
      try {
        const supabase = getSupabase(this.settings);
        const session = await getCurrentSession(supabase);
        // Bail out if a newer display() was called
        if (this.displayGeneration !== generation) return;
        const isSignedIn = !!session;
        // Remember current user id for cache filtering on next open
        const currentUid = session?.user?.id ?? "";
        if (currentUid && this.settings.lastUserId !== currentUid) {
          this.settings.lastUserId = currentUid;
          await this.plugin.saveData(this.settings);
        }

        if (isSignedIn) {
          const signedInEmail = session?.user?.email ?? "";
          this.pendingOtpEmail = null;
          // Hide onboarding bullets and the sign-in row when signed in
          bulletsSection.addClass("fs-hidden");
          connectSetting.settingEl.addClass("fs-hidden");

          // Compact account bar: status + email + credits chip, Manage / Log out
          const bar = authSection.createDiv({ cls: "fs-account-bar" });
          const info = bar.createDiv({ cls: "fs-account-info" });
          info.createSpan({ cls: "fs-status-dot" });
          info.createSpan({ text: signedInEmail, cls: "fs-account-email" });
          const creditsChip = info.createSpan({ text: "…", cls: "fs-credits-chip" });
          const actions = bar.createDiv({ cls: "fs-account-actions" });
          const manageBtn = new ButtonComponent(actions);
          manageBtn.setButtonText("Manage credits");
          manageBtn.onClick(() => {
            window.open("https://app.startflow.ing/credits", "_blank");
          });
          const logoutBtn = new ButtonComponent(actions);
          logoutBtn.setButtonText("Log out");
          logoutBtn.onClick(async () => {
            try {
              const confirmLogout = await confirmModal(this.app, {
                title: "Log out",
                message: "Are you sure you want to log out of Flowstate?",
                cta: "Log out",
                warning: true,
              });
              if (!confirmLogout) return;
              await supaSignOut(supabase);
              // Clear cached routes, user id, and vault connection on logout so we
              // don't show stale data (or scope to the previous account's connection).
              this.settings.routes = {};
              this.settings.lastUserId = "";
              this.plugin.clearMyConnectionId();
              await this.plugin.saveData(this.settings);
              new Notice("Signed out");
              this.display();
            } catch (e: unknown) {
              console.error(e);
              new Notice(`Sign-out failed: ${errorMessage(e)}`);
            }
          });

          // Fill the credits chip (breakdown lives in the hover title; full
          // management is in the web app)
          try {
            const credits = await fetchUserCredits(supabase);
            if (this.displayGeneration !== generation) return;
            if (credits) {
              if (credits.subscription_plan === "unlimited") {
                creditsChip.setText("Unlimited");
                creditsChip.addClass("fs-badge-accent");
              } else {
                const total = (credits.subscription_credits ?? 0) + (credits.purchased_credits ?? 0);
                creditsChip.setText(`${total} credit${total === 1 ? "" : "s"}`);
                creditsChip.setAttribute(
                  "title",
                  `Subscription: ${credits.subscription_credits ?? 0} (rolls over while subscribed) · Top-ups: ${credits.purchased_credits ?? 0} (never expire)`
                );
              }
            } else {
              creditsChip.setText("");
            }
          } catch (creditsErr) {
            console.error("Failed to load credits:", creditsErr);
            creditsChip.setText("");
          }
          return;
        }

        // ---- Signed out ----
        const configOk = () => {
          if (!DEFAULT_SUPABASE_URL || !DEFAULT_SUPABASE_ANON_KEY) {
            new Notice("Supabase config missing. Rebuild plugin with env set.");
            return false;
          }
          return true;
        };

        if (this.pendingOtpEmail) {
          // Code-entry state: a sign-in code was emailed; verify it here. The
          // magic link in the same email still works via the deep-link handler.
          const pendingEmail = this.pendingOtpEmail;
          connectSetting.setName("Enter your code");
          connectSetting.setDesc(
            createFragment((f) => {
              f.appendText("We sent a sign-in code to ");
              f.createEl("strong", { text: pendingEmail });
              f.appendText(". Type it below, or click the link (just make sure if you click, it's on this device).");
            })
          );

          let codeValue = "";
          const verify = async () => {
            if (!codeValue) {
              new Notice("Enter the code from your email");
              return;
            }
            try {
              await verifyEmailOtp(supabase, pendingEmail, codeValue);
              this.pendingOtpEmail = null;
              new Notice("HUZZAH! Welcome to Flowstate!");
              await this.plugin.handleSignedIn();
            } catch (e: unknown) {
              console.error(e);
              new Notice(`That code didn't work: ${errorMessage(e)}`);
            }
          };

          connectSetting.addText((t) => {
            t.setPlaceholder("6-digit code");
            t.onChange((v) => { codeValue = v.trim(); });
            t.inputEl.inputMode = "numeric";
            t.inputEl.addEventListener("keydown", (e) => {
              if (e.key === "Enter") { e.preventDefault(); void verify(); }
            });
          });
          connectSetting.addButton((b) => b.setCta().setButtonText("Sign in").onClick(() => void verify()));

          const links = authSection.createDiv({ cls: "fs-auth-links" });
          const resend = links.createEl("a", { text: "Resend code", cls: "fs-muted-link" });
          resend.addEventListener("click", (e) => {
            e.preventDefault();
            void (async () => {
              try {
                await sendMagicLink(supabase, pendingEmail, "obsidian://flow-state");
                new Notice(`Code re-sent to ${pendingEmail}`);
              } catch (err: unknown) {
                new Notice(`Couldn't resend: ${errorMessage(err)}`);
              }
            })();
          });
          const change = links.createEl("a", { text: "Use a different email", cls: "fs-muted-link" });
          change.addEventListener("click", (e) => {
            e.preventDefault();
            this.pendingOtpEmail = null;
            this.display();
          });
          return;
        }

        // Email-entry state
        const sendCode = async () => {
          if (!configOk()) return;
          if (!emailValue || !emailValue.includes("@")) {
            new Notice("Enter your email address first");
            return;
          }
          try {
            await sendMagicLink(supabase, emailValue, "obsidian://flow-state");
            this.pendingOtpEmail = emailValue;
            this.display();
          } catch (e: unknown) {
            console.error(e);
            new Notice(`Couldn't send the code: ${errorMessage(e)}`);
          }
        };
        connectSetting.addText((t) => {
          t.setPlaceholder("you@example.com");
          t.onChange((v) => { emailValue = v.trim(); });
          t.inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); void sendCode(); }
          });
        });
        connectSetting.addButton((b) => b.setCta().setButtonText("Send code").onClick(() => void sendCode()));
      } catch (e) {
        // Surface minimal info but keep UI rendering
        console.error(e);
      }
    })();

    // Projects section (visible only when signed in)
    void (async () => {
      try {
        const supabase = getSupabase(this.settings);
        const session = await getCurrentSession(supabase);
        // Bail out if a newer display() was called
        if (this.displayGeneration !== generation) return;
        if (!session) return; // not signed in

        // If in editor mode, render the editor page and early-return
        if (this.editingRoute !== undefined) {
          // Hide intro and bullets when in editor mode for a cleaner view
          intro.addClass("fs-hidden");
          bulletsSection.addClass("fs-hidden");
          renderRouteEditor(
            containerEl,
            this.app,
            this.plugin,
            this.editingRoute ?? null,
            () => { this.editingRoute = undefined; this.display(); },
            async (route) => {
              // cache full route row
              this.settings.routes = this.settings.routes || {};
              this.settings.routes[route.id] = route;
              await this.plugin.saveData(this.settings);
            }
          );
          return;
        }

        // Capture section — how notes get INTO Flowstate (the part that
        // happens outside Obsidian). Always visible, native heading.
        new Setting(containerEl).setName("Capture").setHeading();
        const captureBody = containerEl.createDiv();

        const captureIntro = captureBody.createDiv({ cls: "setting-item-description fs-capture-intro" });
        captureIntro.setText("Capture from your phone, by email (each flow has its own address — see its Email Options), or upload right here. Transcriptions land back in this vault on their own.");

        // Mobile app row — QR + links live in a modal behind the button
        const appSetting = new Setting(captureBody)
          .setName("Flowstate app")
          .setDesc("Snap handwritten pages or record voice memos, then send them straight to this vault.");
        appSetting.settingEl.addClass("fs-setting-flush");
        appSetting.addButton((b) =>
          b.setButtonText("Get the app").onClick(() => {
            new GetAppModal(this.app).open();
          })
        );

        // Upload row — capture directly from Obsidian
        const uploadSetting = new Setting(captureBody)
          .setName("Upload a file")
          .setDesc("Send handwriting or audio from this computer: images, PDFs, and audio files.");
        uploadSetting.settingEl.addClass("fs-setting-flush");
        uploadSetting.addButton((b) =>
          b.setCta().setButtonText("Upload").onClick(() => {
            openUploadModal(this.app, this.plugin);
          })
        );

        // Flows section — always visible, native heading
        new Setting(containerEl).setName("Flows").setHeading();
        const projectsBody = containerEl.createDiv();

        // Flows description and buttons
        const header = new Setting(projectsBody)
          .setDesc("Flows describe how to transcribe and save your uploads.");
        header.settingEl.addClass("fs-setting-flush");
        header.addButton((b) =>
          b.setButtonText("Refresh").onClick(() => this.display())
        );
        header.addButton((b) =>
          b.setCta()
            .setButtonText("Add Flow")
            .onClick(() => {
              this.editingRoute = null;
              this.display();
            })
        );

        // Projects list host and renderer
        const flowsListHost = projectsBody.createDiv({ cls: "fs-flows-list" });
        const renderRows = (routes: Route[]) => {
          flowsListHost.empty();
          if (routes.length === 0) {
            const empty = flowsListHost.createDiv({ cls: "setting-item-description" });
            empty.setText("Create your first Flow. Flows tell Flowstate where to save different types of notes.");
            return;
          }
          for (const r of routes) {
            const ui = new Setting(flowsListHost)
              .setName(r.name)
              .setDesc(r.destination_location ?? "");
            // Style project items with border and padding
            ui.settingEl.addClass("fs-flow-item");
            ui.addButton((b) =>
              b.setButtonText("Edit").onClick(async () => {
                try {
                  const supa = getSupabase(this.settings);
                  const fresh = await fetchRouteById(supa, r.id);
                  this.editingRoute = fresh ?? r;
                  // update cache with fresh row if available
                  if (fresh) {
                    this.settings.routes = this.settings.routes || {};
                    this.settings.routes[r.id] = fresh;
                    await this.plugin.saveData(this.settings);
                  }
                } catch {
                  // fallback to existing row if fetch fails
                  this.editingRoute = r;
                }
                this.display();
              })
            );
            ui.addButton((b) => {
              b.setButtonText("Archive");
              b.buttonEl.addClass("fs-archive-btn");
              b.onClick(async () => {
                const ok = await confirmModal(this.app, {
                  title: "Archive flow",
                  message: `Archive "${r.name}"? It will no longer appear in your Flows list.`,
                  cta: "Archive",
                  warning: true,
                });
                if (!ok) return;
                try {
                  const supa = getSupabase(this.settings);
                  await deleteRoute(supa, r.id);
                  if (this.settings.routes) delete this.settings.routes[r.id];
                  await this.plugin.saveData(this.settings);
                  new Notice("Flow archived");
                  this.display();
                } catch (e: unknown) {
                  console.error(e);
                  new Notice(errorMessage(e));
                }
              });
            });
          }
        };

        // Render from cache immediately (only active projects belonging to the last known user)
        const uid = this.settings.lastUserId || null;
        const cachedAll: Route[] = Object.values(this.settings.routes || {});
        const cachedForUser = uid
          ? cachedAll.filter((r) => r.user_id === uid && r.is_active !== false)
          : [];
        // Sort cached routes by id ascending to match the server query order
        cachedForUser.sort((a, b) => (a.id > b.id ? 1 : a.id < b.id ? -1 : 0));
        if (cachedForUser.length > 0) {
          renderRows(cachedForUser);
        } else {
          const loading = flowsListHost.createDiv({ cls: "setting-item-description" });
          loading.setText("Loading Flows…");
        }

        // Fetch fresh from Supabase, update cache, and re-render. Scope to this
        // vault's connection; if it can't be resolved, keep the cached render.
        const connectionId = await this.plugin.getMyConnectionId();
        if (this.displayGeneration !== generation) return;
        if (!connectionId) return;
        const rows: Route[] = await listObsidianRoutes(supabase, connectionId);
        // Bail out if a newer display() was called
        if (this.displayGeneration !== generation) return;
        const valid: Route[] = [];
        const freshIds = new Set<string>();
        for (const r of rows) {
          try {
            const folder = r.destination_location?.trim();
            if (!folder) throw new Error("Missing destination_location");
            valid.push(r);
            freshIds.add(r.id);
            this.settings.routes = this.settings.routes || {};
            this.settings.routes[r.id] = r;
          } catch (e) {
            console.warn("Skipping project due to invalid destination:", r.id, e);
          }
        }
        // Clean up stale cache entries (archived/deleted projects not in fresh list)
        if (this.settings.routes) {
          for (const cachedId of Object.keys(this.settings.routes)) {
            if (!freshIds.has(cachedId)) {
              delete this.settings.routes[cachedId];
            }
          }
        }
        // After fresh fetch, store the definitive user id for future cache filtering
        try {
          const { data: userData2 } = await supabase.auth.getUser();
          const uid2 = userData2.user?.id ?? "";
          if (uid2 && this.settings.lastUserId !== uid2) {
            this.settings.lastUserId = uid2;
          }
        } catch { /* best-effort: ignore failure to read definitive user id */ }
        await this.plugin.saveData(this.settings);
        // Bail out if a newer display() was called
        if (this.displayGeneration !== generation) return;
        renderRows(valid);

        // Recent uploads — a tiny status strip, not a history view. Shows the
        // last few jobs (in-flight, delivered, failed); everything older
        // lives in the web app.
        new Setting(containerEl).setName("Recent uploads").setHeading();
        const recentHost = containerEl.createDiv({ cls: "fs-recent-list" });
        recentHost.createDiv({ text: "Loading…", cls: "setting-item-description" });
        const historyLinkRow = containerEl.createDiv({ cls: "fs-history-link" });
        const historyLink = historyLinkRow.createEl("a", {
          text: "Full history in the web app →",
          cls: "fs-muted-link",
        });
        historyLink.addEventListener("click", (e) => {
          e.preventDefault();
          window.open("https://app.startflow.ing/history", "_blank");
        });

        try {
          const jobs = await listRecentJobs(supabase, connectionId, 5);
          // Bail out if a newer display() was called
          if (this.displayGeneration !== generation) return;
          recentHost.empty();

          if (jobs.length === 0) {
            recentHost.createDiv({
              text: "Nothing here yet — send something and it'll show up.",
              cls: "setting-item-description",
            });
          }
          for (const job of jobs) {
            const failed = !!job.has_error;
            const delivered = job.status === "delivered";
            const row = recentHost.createDiv({ cls: "fs-recent-row" });
            row.createSpan({
              cls: `fs-recent-dot ${failed ? "fs-dot-error" : delivered ? "fs-dot-ok" : "fs-dot-pending"}`,
            });
            const info = row.createDiv({ cls: "fs-recent-info" });
            const title = job.final_title
              || (job.original_filename ? job.original_filename.replace(/\.[^/.]+$/, "") : "Untitled");
            info.createDiv({ text: title, cls: "fs-recent-title" });
            const statusLabel = failed
              ? (job.error_message || "Failed")
              : delivered ? "Delivered"
              : job.status === "transcribed" ? "Syncing…"
              : "Processing…";
            info.createDiv({
              text: `${statusLabel} · ${formatRelativeTime(job.created_at)}`,
              cls: `fs-recent-meta${failed ? " fs-error-text" : ""}`,
            });

            // Delivered rows open the note in the vault
            const fileMatch = delivered && job.destination_url
              ? job.destination_url.match(/file=([^&]+)/)
              : null;
            if (fileMatch) {
              row.addClass("fs-recent-clickable");
              row.addEventListener("click", () => {
                let path = decodeURIComponent(fileMatch[1]);
                while (path.startsWith("/")) path = path.slice(1);
                try {
                  (this.app as unknown as { setting: { close(): void } }).setting.close();
                } catch { /* best-effort */ }
                void this.app.workspace.openLinkText(path, "", false);
              });
            }
          }
        } catch (recentErr) {
          // Bail out if a newer display() was called
          if (this.displayGeneration !== generation) return;
          console.error("Failed to load recent uploads:", recentErr);
          recentHost.empty();
          recentHost.createDiv({
            text: "Couldn't load recent uploads",
            cls: "setting-item-description fs-error-text",
          });
        }
      } catch (e) {
        console.error(e);
      }
    })();
    // Removed global destination/template and conflict/interval controls; use per-flow configuration instead
  }
}