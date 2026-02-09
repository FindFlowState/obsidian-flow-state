import { App, PluginSettingTab, Setting, Notice, ButtonComponent } from "obsidian";
import type FlowStatePlugin from "./main";
import type { Route } from "@flowstate/supabase-types";
import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY } from "./config";
import { getSupabase, getCurrentSession, signOut as supaSignOut, sendMagicLink, listObsidianRoutes, deleteRoute, fetchRouteById, fetchUserCredits } from "./supabase";
import { renderRouteEditor } from "./routeEditor";

export type PluginSettings = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  // Cache entire Route rows keyed by id (includes destination_config JSON)
  routes?: Record<string, Route>;
  // Last known signed-in user id to filter cached routes without awaiting auth
  lastUserId?: string;
};

export const DEFAULT_SETTINGS: PluginSettings = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  routes: {},
  lastUserId: ""
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

      (async () => {
        try {
          const supabase = getSupabase(this.settings);
          const route = await fetchRouteById(supabase, projectId);
          // Bail out if a newer display() was called
          if (this.displayGeneration !== generation) return;
          if (route) {
            this.editingRoute = route;
            this.display(); // Re-render with the project editor
          } else {
            new Notice("Project not found");
            this.display(); // Show normal list view
          }
        } catch (e: any) {
          // Bail out if a newer display() was called
          if (this.displayGeneration !== generation) return;
          console.error("Failed to load deferred project:", e);
          new Notice(`Failed to load project: ${e?.message ?? e}`);
          this.display(); // Show normal list view on error
        }
      })();
      return; // Don't render yet, wait for async fetch
    }

    containerEl.empty();

    // FlowState title (plain text, styled like other plugins)
    const titleEl = containerEl.createEl("div", { text: "FlowState" });
    titleEl.style.fontSize = "1.17em";
    titleEl.style.fontWeight = "600";
    titleEl.style.marginBottom = "8px";

    // Intro text with Learn more link on same line
    const intro = containerEl.createEl("div");
    intro.appendText("Integrate handwritten notes and voice recordings into Obsidian. ");
    const learnMoreLink = intro.createEl("a", { text: "Learn more →", href: "https://seekflowstate.com" });
    learnMoreLink.style.color = "var(--text-muted)";
    intro.style.fontSize = "0.9em";
    intro.style.marginBottom = "16px";

    // How it works bullets (will be hidden when signed in)
    const bulletsSection = containerEl.createDiv({ cls: "fs-onboarding-bullets" });
    const bullets = [
      "Upload your handwriting or voice note to the FlowState app. Take a photo, record audio, or send an email.",
      "FlowState transcribes your note and enriches it with AI. For example, it can translate, summarize, or extract action items.",
      "Notes sync automatically to your vault. The original note is also saved as an attachment.",
    ];
    const bulletList = bulletsSection.createEl("ul");
    bulletList.style.margin = "0 0 12px 0";
    bulletList.style.paddingLeft = "20px";
    bulletList.style.fontSize = "0.85em";
    bulletList.style.color = "var(--text-muted)";
    for (const bullet of bullets) {
      const li = bulletList.createEl("li", { text: bullet });
      li.style.marginBottom = "4px";
    }
    bulletsSection.style.marginBottom = "20px";

    // Unified connect section: email + connect/logout button
    // Place both rows inside a fixed wrapper so async rendering preserves order
    let emailValue = "";
    const authSection = containerEl.createDiv();
    const connectSetting = new Setting(authSection)
      .setName("Sign Up / Sign In");
    connectSetting.setDesc("Enter your email to get started");

    (async () => {
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
          bulletsSection.style.display = "none";
          // Show prominent connected status
          connectSetting.setName("Account");
          connectSetting.setDesc("");
          // Add status indicator
          const statusEl = connectSetting.descEl.createDiv();
          statusEl.style.display = "flex";
          statusEl.style.alignItems = "center";
          statusEl.style.gap = "6px";
          const dot = statusEl.createSpan();
          dot.style.width = "8px";
          dot.style.height = "8px";
          dot.style.borderRadius = "50%";
          dot.style.backgroundColor = "var(--color-green)";
          dot.style.display = "inline-block";
          const statusText = statusEl.createSpan({ text: `Connected as ${signedInEmail}` });
          statusText.style.color = "var(--text-muted)";
        } else {
          // Create email field for sign-in
          connectSetting.addText((t) => {
            t.setPlaceholder("you@example.com");
            t.onChange((v) => { emailValue = v.trim(); });
            // Allow Enter key to submit
            t.inputEl.addEventListener("keydown", (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitAuth();
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
              const confirmLogout = window.confirm("Are you sure you want to log out of FlowState?");
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
          } catch (e: any) {
            console.error(e);
            new Notice(`${isSignedIn ? "Sign-out" : "Magic link"} failed: ${e?.message ?? e}`);
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
    (async () => {
      try {
        const supabase = getSupabase(this.settings);
        const session = await getCurrentSession(supabase);
        // Bail out if a newer display() was called
        if (this.displayGeneration !== generation) return;
        if (!session) return; // not signed in

        // If in editor mode, render the editor page and early-return
        if (this.editingRoute !== undefined) {
          // Hide intro and bullets when in editor mode for a cleaner view
          intro.style.display = "none";
          bulletsSection.style.display = "none";
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
        const projectsDivider = containerEl.createDiv();
        projectsDivider.style.borderTop = "1px solid var(--background-modifier-border)";
        projectsDivider.style.margin = "16px 0 6px 0";

        const projectsSection = containerEl.createDiv({ cls: "fs-projects-section" });
        const projectsHeaderRow = projectsSection.createDiv();
        projectsHeaderRow.style.display = "flex";
        projectsHeaderRow.style.alignItems = "center";
        projectsHeaderRow.style.gap = "6px";
        projectsHeaderRow.style.cursor = "pointer";
        projectsHeaderRow.style.marginTop = "18px";
        projectsHeaderRow.style.marginBottom = "6px";

        const projectsArrow = projectsHeaderRow.createSpan({ text: "▾" });
        projectsArrow.style.fontSize = "0.9em";
        const projectsTitle = projectsHeaderRow.createEl("h2", { text: "Projects" });
        projectsTitle.style.fontSize = "1.5em";
        projectsTitle.style.margin = "0";

        const projectsBody = projectsSection.createDiv();
        let projectsOpen = true;

        const updateProjectsVisibility = () => {
          projectsBody.style.display = projectsOpen ? "" : "none";
          projectsArrow.textContent = projectsOpen ? "▾" : "▸";
        };
        projectsHeaderRow.addEventListener("click", () => {
          projectsOpen = !projectsOpen;
          updateProjectsVisibility();
        });
        updateProjectsVisibility();

        // Projects description and buttons
        const header = new Setting(projectsBody)
          .setDesc("Projects describe how to transcribe and save your uploads.");
        header.settingEl.style.borderTop = "none";
        header.settingEl.style.paddingTop = "0";
        header.settingEl.style.marginTop = "0";
        header.addButton((b) =>
          b.setButtonText("Refresh").onClick(() => this.display())
        );
        header.addButton((b) =>
          b.setCta()
            .setButtonText("Add Project")
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
            empty.setText("Create your first project. Projects tell FlowState where to save different types of notes.");
            return;
          }
          for (const r of routes) {
            const ui = new Setting(flowsListHost)
              .setName(r.name)
              .setDesc(`Destination: ${r.destination_location}`);
            // Style project items with border and padding
            ui.settingEl.style.border = "1px solid var(--background-modifier-border)";
            ui.settingEl.style.borderRadius = "6px";
            ui.settingEl.style.padding = "12px";
            ui.settingEl.style.marginBottom = "8px";
            ui.nameEl.style.fontSize = "1.0em";
            ui.descEl.style.color = "var(--text-muted)";
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
                } catch (e) {
                  // fallback to existing row if fetch fails
                  this.editingRoute = r;
                }
                this.display();
              })
            );
            ui.addButton((b) => {
              b.setButtonText("Archive");
              const el = b.buttonEl;
              el.style.background = "transparent";
              el.style.border = "1px solid var(--text-muted)";
              el.style.color = "var(--text-normal)";
              b.onClick(async () => {
                const ok = window.confirm(`Archive project "${r.name}"? It will no longer appear in your projects list.`);
                if (!ok) return;
                try {
                  const supa = getSupabase(this.settings);
                  await deleteRoute(supa, r.id);
                  if (this.settings.routes) delete this.settings.routes[r.id];
                  await this.plugin.saveData(this.settings);
                  new Notice("Project archived");
                  this.display();
                } catch (e: any) {
                  console.error(e);
                  new Notice(e?.message ?? String(e));
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
          renderRows(cachedForUser as Route[]);
        } else {
          const loading = flowsListHost.createDiv({ cls: "setting-item-description" });
          loading.setText("Loading projects…");
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
        } catch {}
        await this.plugin.saveData(this.settings);
        // Bail out if a newer display() was called
        if (this.displayGeneration !== generation) return;
        renderRows(valid);

        // Sync section (collapsible, collapsed by default)
        const syncDivider = containerEl.createDiv();
        syncDivider.style.borderTop = "1px solid var(--background-modifier-border)";
        syncDivider.style.margin = "16px 0 6px 0";

        const syncSection = containerEl.createDiv({ cls: "fs-sync-section" });
        const syncHeaderRow = syncSection.createDiv();
        syncHeaderRow.style.display = "flex";
        syncHeaderRow.style.alignItems = "center";
        syncHeaderRow.style.gap = "6px";
        syncHeaderRow.style.cursor = "pointer";
        syncHeaderRow.style.marginTop = "18px";
        syncHeaderRow.style.marginBottom = "6px";

        const syncArrow = syncHeaderRow.createSpan({ text: "▸" });
        syncArrow.style.fontSize = "0.9em";
        const syncTitle = syncHeaderRow.createEl("h2", { text: "Sync" });
        syncTitle.style.fontSize = "1.5em";
        syncTitle.style.margin = "0";

        const syncBody = syncSection.createDiv();
        let syncOpen = false;

        const updateSyncVisibility = () => {
          syncBody.style.display = syncOpen ? "" : "none";
          syncArrow.textContent = syncOpen ? "▾" : "▸";
        };
        syncHeaderRow.addEventListener("click", () => {
          syncOpen = !syncOpen;
          updateSyncVisibility();
        });
        updateSyncVisibility();

        // Sync description
        const syncDesc = syncBody.createDiv();
        syncDesc.style.fontSize = "0.9em";
        syncDesc.style.color = "var(--text-muted)";
        syncDesc.style.marginBottom = "12px";
        syncDesc.setText("Pull transcribed notes from FlowState to your vault.");

        // Sync log area
        const syncLogArea = syncBody.createEl("textarea");
        syncLogArea.style.width = "100%";
        syncLogArea.style.height = "120px";
        syncLogArea.style.fontFamily = "monospace";
        syncLogArea.style.fontSize = "0.85em";
        syncLogArea.style.resize = "vertical";
        syncLogArea.style.marginBottom = "8px";
        syncLogArea.style.padding = "8px";
        syncLogArea.style.border = "1px solid var(--background-modifier-border)";
        syncLogArea.style.borderRadius = "4px";
        syncLogArea.style.backgroundColor = "var(--background-secondary)";
        syncLogArea.style.color = "var(--text-normal)";
        syncLogArea.readOnly = true;
        syncLogArea.placeholder = "Sync logs will appear here...";

        // Sync buttons row
        const syncButtonRow = new Setting(syncBody);
        syncButtonRow.settingEl.style.borderTop = "none";
        syncButtonRow.settingEl.style.padding = "0";

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
            } catch (e: any) {
              const endTime = new Date().toLocaleTimeString();
              syncLogArea.value += `[${endTime}] Error: ${e?.message ?? e}\n\n`;
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
        const creditsDivider = containerEl.createDiv();
        creditsDivider.style.borderTop = "1px solid var(--background-modifier-border)";
        creditsDivider.style.margin = "16px 0 6px 0";

        // Collapsible header
        const creditsSection = containerEl.createDiv({ cls: "fs-credits-section" });
        const creditsHeaderRow = creditsSection.createDiv();
        creditsHeaderRow.style.display = "flex";
        creditsHeaderRow.style.alignItems = "center";
        creditsHeaderRow.style.gap = "6px";
        creditsHeaderRow.style.cursor = "pointer";
        creditsHeaderRow.style.marginTop = "18px";
        creditsHeaderRow.style.marginBottom = "6px";

        const creditsArrow = creditsHeaderRow.createSpan({ text: "▸" });
        creditsArrow.style.fontSize = "0.9em";
        const creditsTitle = creditsHeaderRow.createEl("h2", { text: "Credits" });
        creditsTitle.style.fontSize = "1.5em";
        creditsTitle.style.margin = "0";
        // Badge to show total credits in collapsed state
        const creditsBadge = creditsHeaderRow.createSpan({ text: "" });
        creditsBadge.style.fontSize = "0.85em";
        creditsBadge.style.color = "var(--text-muted)";
        creditsBadge.style.marginLeft = "8px";

        const creditsBody = creditsSection.createDiv();
        let creditsOpen = false;

        const updateCreditsVisibility = () => {
          creditsBody.style.display = creditsOpen ? "" : "none";
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
              creditsBadge.style.color = "var(--interactive-accent)";
            } else {
              creditsBadge.setText(`(${total})`);
            }
            creditsBadge.style.display = "";

            // Explanation text with Manage Credits button
            const creditsDescSetting = new Setting(creditsHost)
              .setDesc(isUnlimited
                ? "You have an Unlimited plan. Upload as much as you want!"
                : "Each page or minute of audio that you upload uses one credit. You get 50 free credits to get started. Need more? Upgrade your plan or buy top-ups.");
            creditsDescSetting.settingEl.style.borderTop = "none";
            creditsDescSetting.settingEl.style.paddingTop = "0";
            creditsDescSetting.settingEl.style.marginTop = "0";
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
              totalSetting.settingEl.style.borderTop = "none";
              totalSetting.settingEl.style.padding = "6px 0";

              const subscriptionSetting = new Setting(creditsHost)
                .setName("Subscription Credits")
                .setDesc(`${credits.subscription_credits ?? 0} (rolls over while subscribed)`);
              subscriptionSetting.settingEl.style.borderTop = "none";
              subscriptionSetting.settingEl.style.padding = "6px 0";

              const topupSetting = new Setting(creditsHost)
                .setName("Top-up Credits")
                .setDesc(`${credits.purchased_credits ?? 0} (never expire)`);
              topupSetting.settingEl.style.borderTop = "none";
              topupSetting.settingEl.style.padding = "6px 0";
            }
          }
        } catch (creditsErr) {
          // Bail out if a newer display() was called
          if (this.displayGeneration !== generation) return;
          console.error("Failed to load credits:", creditsErr);
          creditsHost.empty();
          const errorDiv = creditsHost.createDiv({ cls: "setting-item-description" });
          errorDiv.setText("Failed to load credits");
          errorDiv.style.color = "var(--text-error)";
        }
      } catch (e) {
        console.error(e);
      }
    })();
    // Removed global destination/template and conflict/interval controls; use per-flow configuration instead
  }
}