import { App, PluginSettingTab, Setting, Notice, ButtonComponent } from "obsidian";
import type FlowStatePlugin from "./main";
import type { Route } from "./types";
import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY, DEFAULT_INGEST_EMAIL_DOMAIN } from "./config";
import { getSupabase, getCurrentSession, signOut as supaSignOut, sendMagicLink, verifyEmailOtp, fetchUserHandle, listObsidianRoutes, deleteRoute, fetchRouteById, fetchUserCredits } from "./supabase";
import { computeFlowEmail } from "./email";
import qrcode from "qrcode-generator";
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
    connectSetting.setDesc("Enter your email and we'll send you a sign-in code. New accounts start with 50 free credits.");

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
          // Hide onboarding bullets when signed in
          bulletsSection.addClass("fs-hidden");
          // Show prominent connected status
          connectSetting.setName("Account");
          connectSetting.setDesc("");
          const statusEl = connectSetting.descEl.createDiv({ cls: "fs-status-row" });
          statusEl.createSpan({ cls: "fs-status-dot" });
          statusEl.createSpan({ text: `Connected as ${signedInEmail}`, cls: "fs-muted-text" });

          const logoutBtn = new ButtonComponent(connectSetting.controlEl.createDiv());
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
          connectSetting.setDesc(`We emailed a sign-in code to ${pendingEmail}. Type it here — or click the link in that email on this device.`);

          let codeValue = "";
          const verify = async () => {
            if (!codeValue) {
              new Notice("Enter the code from your email");
              return;
            }
            try {
              await verifyEmailOtp(supabase, pendingEmail, codeValue);
              this.pendingOtpEmail = null;
              new Notice("You're in. Welcome to Flowstate!");
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
        // happens outside Obsidian). Collapsible, open by default.
        containerEl.createDiv({ cls: "fs-divider" });
        const captureSection = containerEl.createDiv({ cls: "fs-capture-section" });
        const captureHeaderRow = captureSection.createDiv({ cls: "fs-section-header-row" });
        const captureArrow = captureHeaderRow.createSpan({ text: "▾", cls: "fs-section-arrow" });
        captureHeaderRow.createEl("div", { text: "Capture", cls: "fs-section-title" });
        const captureBody = captureSection.createDiv();
        let captureOpen = true;
        const updateCaptureVisibility = () => {
          captureBody.toggleClass("fs-hidden", !captureOpen);
          captureArrow.textContent = captureOpen ? "▾" : "▸";
        };
        captureHeaderRow.addEventListener("click", () => {
          captureOpen = !captureOpen;
          updateCaptureVisibility();
        });
        updateCaptureVisibility();

        const captureIntro = captureBody.createDiv({ cls: "setting-item-description fs-capture-intro" });
        captureIntro.setText("Capturing happens outside Obsidian — from your phone or by email. Transcriptions land back here on their own.");

        // Mobile app row with a QR code for grabbing the app from desktop
        const appSetting = new Setting(captureBody)
          .setName("Flowstate app")
          .setDesc("Snap handwritten pages or record voice memos, then send them straight to this vault.");
        appSetting.settingEl.addClass("fs-setting-flush");
        const qrHost = appSetting.controlEl.createDiv({ cls: "fs-qr-box" });
        try {
          const qr = qrcode(0, "M");
          qr.addData("https://seekflowstate.com");
          qr.make();
          qrHost.createEl("img", {
            attr: { src: qr.createDataURL(3, 6), alt: "QR code for seekflowstate.com" },
            cls: "fs-qr-img",
          });
          qrHost.createDiv({ text: "Scan to download", cls: "fs-qr-caption" });
        } catch { /* QR is a nicety; skip on failure */ }
        appSetting.addButton((b) =>
          b.setButtonText("Get the app").onClick(() => {
            window.open("https://seekflowstate.com", "_blank");
          })
        );

        // Email row; the address resolves after flows load further down
        const captureEmailSetting = new Setting(captureBody)
          .setName("Email your pages")
          .setDesc("");
        captureEmailSetting.settingEl.addClass("fs-setting-flush");
        const captureEmailControl = captureEmailSetting.controlEl.createDiv();
        const setCaptureEmail = (addr: string | null) => {
          captureEmailSetting.descEl.empty();
          captureEmailControl.empty();
          if (addr) {
            captureEmailSetting.setDesc("Send pages from your e-ink tablet — or anything with an outbox — straight to your first flow:");
            const addrRow = captureEmailSetting.descEl.createDiv({ cls: "fs-capture-email" });
            addrRow.createEl("code", { text: addr });
            const copyBtn = new ButtonComponent(captureEmailControl);
            copyBtn.setButtonText("Copy");
            copyBtn.onClick(async () => {
              try {
                await navigator.clipboard.writeText(addr);
                new Notice("Email address copied");
              } catch (err: unknown) {
                new Notice(errorMessage(err));
              }
            });
          } else {
            captureEmailSetting.setDesc("Save a flow below to get its unique email address. Each flow has its own.");
          }
        };
        setCaptureEmail(null);

        // Projects section (collapsible, open by default)
        containerEl.createDiv({ cls: "fs-divider" });

        const projectsSection = containerEl.createDiv({ cls: "fs-projects-section" });
        const projectsHeaderRow = projectsSection.createDiv({ cls: "fs-section-header-row" });

        const projectsArrow = projectsHeaderRow.createSpan({ text: "▾", cls: "fs-section-arrow" });
        projectsHeaderRow.createEl("div", { text: "Flows", cls: "fs-section-title" });

        const projectsBody = projectsSection.createDiv();
        let projectsOpen = true;

        const updateProjectsVisibility = () => {
          projectsBody.toggleClass("fs-hidden", !projectsOpen);
          projectsArrow.textContent = projectsOpen ? "▾" : "▸";
        };
        projectsHeaderRow.addEventListener("click", () => {
          projectsOpen = !projectsOpen;
          updateProjectsVisibility();
        });
        updateProjectsVisibility();

        // Projects description and buttons
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

        // Fill in the capture email now that flows are known
        try {
          const firstSlug = valid.find((r) => r.slug)?.slug ?? null;
          const handle = firstSlug ? await fetchUserHandle(supabase) : null;
          if (this.displayGeneration !== generation) return;
          setCaptureEmail(computeFlowEmail(handle, firstSlug, DEFAULT_INGEST_EMAIL_DOMAIN));
        } catch {
          setCaptureEmail(null);
        }

        // Credits section (collapsible, collapsed by default)
        containerEl.createDiv({ cls: "fs-divider" });

        // Collapsible header
        const creditsSection = containerEl.createDiv({ cls: "fs-credits-section" });
        const creditsHeaderRow = creditsSection.createDiv({ cls: "fs-section-header-row" });

        const creditsArrow = creditsHeaderRow.createSpan({ text: "▸", cls: "fs-section-arrow" });
        creditsHeaderRow.createEl("div", { text: "Credits", cls: "fs-section-title" });
        // Badge to show total credits in collapsed state
        const creditsBadge = creditsHeaderRow.createSpan({ text: "", cls: "fs-credits-badge" });

        const creditsBody = creditsSection.createDiv();
        let creditsOpen = false;

        const updateCreditsVisibility = () => {
          creditsBody.toggleClass("fs-hidden", !creditsOpen);
          creditsArrow.textContent = creditsOpen ? "▾" : "▸";
        };
        creditsHeaderRow.addEventListener("click", () => {
          creditsOpen = !creditsOpen;
          updateCreditsVisibility();
        });
        updateCreditsVisibility();

        const creditsHost = creditsBody.createDiv();
        const creditsLoading = creditsHost.createDiv({ cls: "setting-item-description" });
        creditsLoading.setText("Loading credits…");

        try {
          const credits = await fetchUserCredits(supabase);
          // Bail out if a newer display() was called
          if (this.displayGeneration !== generation) return;
          creditsHost.empty();

          if (credits) {
            const isUnlimited = credits.subscription_plan === "unlimited";
            const total = (credits.subscription_credits ?? 0) + (credits.purchased_credits ?? 0);

            // Update collapsed header badge
            if (isUnlimited) {
              creditsBadge.setText("(Unlimited)");
              creditsBadge.addClass("fs-badge-accent");
            } else {
              creditsBadge.setText(`(${total})`);
            }

            // Explanation text with Manage Credits button
            const creditsDescSetting = new Setting(creditsHost)
              .setDesc(isUnlimited
                ? "You have an Unlimited plan. Upload as much as you want!"
                : "Each page or minute of audio that you upload uses one credit. You get 50 free credits to get started. Need more? Upgrade your plan or buy top-ups.");
            creditsDescSetting.settingEl.addClass("fs-setting-flush");
            creditsDescSetting.addButton((b) =>
              b.setCta()
                .setButtonText("Manage Credits")
                .onClick(() => {
                  window.open("https://app.startflow.ing/credits", "_blank");
                })
            );

            if (!isUnlimited) {
              const totalSetting = new Setting(creditsHost)
                .setName("Total Credits")
                .setDesc(String(total));
              totalSetting.settingEl.addClass("fs-credit-row");

              const subscriptionSetting = new Setting(creditsHost)
                .setName("Subscription Credits")
                .setDesc(`${credits.subscription_credits ?? 0} (rolls over while subscribed)`);
              subscriptionSetting.settingEl.addClass("fs-credit-row");

              const topupSetting = new Setting(creditsHost)
                .setName("Top-up Credits")
                .setDesc(`${credits.purchased_credits ?? 0} (never expire)`);
              topupSetting.settingEl.addClass("fs-credit-row");
            }
          }
        } catch (creditsErr) {
          // Bail out if a newer display() was called
          if (this.displayGeneration !== generation) return;
          console.error("Failed to load credits:", creditsErr);
          creditsHost.empty();
          const errorDiv = creditsHost.createDiv({ cls: "setting-item-description" });
          errorDiv.setText("Failed to load credits");
          errorDiv.addClass("fs-error-text");
        }
      } catch (e) {
        console.error(e);
      }
    })();
    // Removed global destination/template and conflict/interval controls; use per-flow configuration instead
  }
}