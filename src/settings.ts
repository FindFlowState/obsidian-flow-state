import { App, PluginSettingTab, Setting, Notice, ButtonComponent } from "obsidian";
import type FlowStatePlugin from "./main";
import type { Route } from "./types";
import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY } from "./config";
import { getSupabase, getCurrentSession, signOut as supaSignOut, sendMagicLink, listObsidianRoutes, deleteRoute, fetchRouteById, fetchUserCredits } from "./supabase";
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
};

export const DEFAULT_SETTINGS: PluginSettings = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  routes: {},
  lastUserId: "",
  authStore: {}
};

export class FlowStateSettingTab extends PluginSettingTab {
  // undefined -> list view; null -> new project; Route -> edit existing
  private editingRoute: Route | null | undefined = undefined;
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
    intro.appendText("Integrate handwritten notes and voice recordings into Obsidian. ");
    intro.createEl("a", { text: "Learn more →", href: "https://seekflowstate.com", cls: "fs-muted-link" });

    // How it works bullets (will be hidden when signed in)
    const bulletsSection = containerEl.createDiv({ cls: "fs-onboarding-bullets" });
    const bullets = [
      "Upload your handwriting or voice note to the Flowstate app. Take a photo, record audio, or send an email.",
      "Flowstate transcribes your note and enriches it with AI. For example, it can translate, summarize, or extract action items.",
      "Notes sync automatically to your vault. The original note is also saved as an attachment.",
    ];
    const bulletList = bulletsSection.createEl("ul", { cls: "fs-onboarding-list" });
    for (const bullet of bullets) {
      bulletList.createEl("li", { text: bullet });
    }

    // Unified connect section: email + connect/logout button
    // Place both rows inside a fixed wrapper so async rendering preserves order
    let emailValue = "";
    const authSection = containerEl.createDiv();
    const connectSetting = new Setting(authSection)
      .setName("Sign Up / Sign In");
    connectSetting.setDesc("Enter your email to get started");

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

        // Update UI based on sign-in state
        if (isSignedIn) {
          const signedInEmail = session?.user?.email ?? "";
          emailValue = signedInEmail;
          // Hide onboarding bullets when signed in
          bulletsSection.addClass("fs-hidden");
          // Show prominent connected status
          connectSetting.setName("Account");
          connectSetting.setDesc("");
          // Add status indicator
          const statusEl = connectSetting.descEl.createDiv({ cls: "fs-status-row" });
          statusEl.createSpan({ cls: "fs-status-dot" });
          statusEl.createSpan({ text: `Connected as ${signedInEmail}`, cls: "fs-muted-text" });
        } else {
          // Create email field for sign-in
          connectSetting.addText((t) => {
            t.setPlaceholder("you@example.com");
            t.onChange((v) => { emailValue = v.trim(); });
            // Allow Enter key to submit
            t.inputEl.addEventListener("keydown", (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitAuth();
              }
            });
          });
        }

        // Shared auth submit handler
        const submitAuth = async () => {
          try {
            const url = DEFAULT_SUPABASE_URL;
            const key = DEFAULT_SUPABASE_ANON_KEY;
            if (!url || !key) {
              new Notice("Supabase config missing. Rebuild plugin with env set.");
              return;
            }
            if (isSignedIn) {
              // Confirm before logging out
              const confirmLogout = await confirmModal(this.app, {
              title: "Log out",
              message: "Are you sure you want to log out of Flowstate?",
              cta: "Log out",
              warning: true,
            });
              if (!confirmLogout) return;
              await supaSignOut(supabase);
              // Clear cached routes and user id on logout so we don't show stale data
              this.settings.routes = {};
              this.settings.lastUserId = "";
              await this.plugin.saveData(this.settings);
              new Notice("Signed out");
              this.display();
              return;
            }
            // Magic Link flow requires an email
            if (!emailValue) {
              new Notice("Enter your email to receive a Magic Link");
              return;
            }
            const redirectTo = "obsidian://flow-state";
            await sendMagicLink(supabase, emailValue, redirectTo);
            new Notice(`Magic link sent to ${emailValue}`);
          } catch (e: unknown) {
            console.error(e);
            new Notice(`${isSignedIn ? "Sign-out" : "Magic link"} failed: ${errorMessage(e)}`);
          }
        };

        const actionRow = connectSetting.controlEl.createDiv();
        const btn = new ButtonComponent(actionRow);
        btn.setButtonText(isSignedIn ? "Log out" : "Connect");
        btn.onClick(submitAuth);
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

        // Fetch fresh from Supabase, update cache, and re-render
        const rows: Route[] = await listObsidianRoutes(supabase);
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

        // Sync section (collapsible, collapsed by default)
        containerEl.createDiv({ cls: "fs-divider" });

        const syncSection = containerEl.createDiv({ cls: "fs-sync-section" });
        const syncHeaderRow = syncSection.createDiv({ cls: "fs-section-header-row" });

        const syncArrow = syncHeaderRow.createSpan({ text: "▸", cls: "fs-section-arrow" });
        syncHeaderRow.createEl("div", { text: "Sync", cls: "fs-section-title" });

        const syncBody = syncSection.createDiv();
        let syncOpen = false;

        const updateSyncVisibility = () => {
          syncBody.toggleClass("fs-hidden", !syncOpen);
          syncArrow.textContent = syncOpen ? "▾" : "▸";
        };
        syncHeaderRow.addEventListener("click", () => {
          syncOpen = !syncOpen;
          updateSyncVisibility();
        });
        updateSyncVisibility();

        // Sync description
        const syncDesc = syncBody.createDiv({ cls: "fs-section-desc" });
        syncDesc.setText("Pull transcribed notes from Flowstate to your vault.");

        // Sync log area
        const syncLogArea = syncBody.createEl("textarea", { cls: "fs-sync-log" });
        syncLogArea.readOnly = true;
        syncLogArea.placeholder = "Sync logs will appear here...";

        // Sync buttons row
        const syncButtonRow = new Setting(syncBody);
        syncButtonRow.settingEl.addClass("fs-setting-no-border-pad");

        let isSyncing = false;
        syncButtonRow.addButton((b) =>
          b.setCta().setButtonText("Sync Now").onClick(async () => {
            if (isSyncing) return;
            isSyncing = true;
            b.setButtonText("Syncing...");
            b.setDisabled(true);

            const timestamp = new Date().toLocaleTimeString();
            syncLogArea.value += `[${timestamp}] Starting sync...\n`;
            syncLogArea.scrollTop = syncLogArea.scrollHeight;

            try {
              const result = await this.plugin.syncWithLogs();
              const endTime = new Date().toLocaleTimeString();

              if (!result.success) {
                syncLogArea.value += `[${endTime}] Error: ${result.error}\n`;
              } else if (result.entries.length === 0) {
                syncLogArea.value += `[${endTime}] No new files to sync (${result.jobsFound} job(s) found)\n`;
              } else {
                syncLogArea.value += `[${endTime}] Synced ${result.entries.length} file(s):\n`;
                for (const entry of result.entries) {
                  syncLogArea.value += `  → ${entry.path}\n`;
                }
              }
              syncLogArea.value += "\n";
            } catch (e: unknown) {
              const endTime = new Date().toLocaleTimeString();
              syncLogArea.value += `[${endTime}] Error: ${errorMessage(e)}\n\n`;
            }

            syncLogArea.scrollTop = syncLogArea.scrollHeight;
            b.setButtonText("Sync Now");
            b.setDisabled(false);
            isSyncing = false;
          })
        );
        syncButtonRow.addButton((b) =>
          b.setButtonText("Copy Logs").onClick(async () => {
            await navigator.clipboard.writeText(syncLogArea.value);
            new Notice("Logs copied to clipboard");
          })
        );
        syncButtonRow.addButton((b) =>
          b.setButtonText("Clear").onClick(() => {
            syncLogArea.value = "";
          })
        );

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