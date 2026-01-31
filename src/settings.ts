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
    const titleEl = containerEl.createEl("h1");
    const titleLink = titleEl.createEl("a", { text: "FlowState", href: "https://findflow.ai" });
    titleLink.style.textDecoration = "none";
    titleLink.style.color = "inherit";
    titleEl.style.marginBottom = "8px";
    // Intro text
    const intro = containerEl.createEl("div");
    intro.appendText("Turn handwritten notes and voice memos into Obsidian notes.");
    intro.style.fontSize = "0.9em";
    intro.style.marginBottom = "16px";

    // How it works bullets (will be hidden when signed in)
    const bulletsSection = containerEl.createDiv({ cls: "fs-onboarding-bullets" });
    const bullets = [
      "Upload your handwriting or voice note to the FlowState app. Take a photo, record audio, or send an email.",
      "FlowState transcribes your note and enriches it with AI. For example, it can translate, summarize, or extract action items.",
      "Notes sync automatically to your vault.",
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
    // Learn more link
    const learnMoreEl = bulletsSection.createDiv();
    learnMoreEl.style.marginBottom = "20px";
    learnMoreEl.style.fontSize = "0.85em";
    const learnMoreLink = learnMoreEl.createEl("a", { text: "Learn more at findflow.ai →", href: "https://findflow.ai" });
    learnMoreLink.style.color = "var(--text-muted)";

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
          });
        }

        const actionRow = connectSetting.controlEl.createDiv();
        const btn = new ButtonComponent(actionRow);
        btn.setButtonText(isSignedIn ? "Log out" : "Connect");
        btn.onClick(async () => {
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
              const redirectTo = "obsidian://flow-state-oauth";
              await sendMagicLink(supabase, emailValue, redirectTo);
              new Notice(`Magic link sent to ${emailValue}`);
            } catch (e: any) {
              console.error(e);
              new Notice(`${isSignedIn ? "Sign-out" : "Magic link"} failed: ${e?.message ?? e}`);
            }
          });
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

        // Add a subtle horizontal divider above the Projects section
        const flowsDivider = containerEl.createDiv();
        flowsDivider.style.borderTop = "1px solid var(--background-modifier-border)";
        flowsDivider.style.margin = "16px 0 6px 0";
        const flowsHeader = containerEl.createEl("h2", { text: "Projects" });
        // Make header visually larger and add spacing
        flowsHeader.style.fontSize = "1.5em";
        flowsHeader.style.marginTop = "18px";
        flowsHeader.style.marginBottom = "6px";
        const header = new Setting(containerEl)
          .setDesc("Projects describe how to transcribe and save your uploads.");
        // Remove the default top border (horizontal rule) under the Flows header
        header.settingEl.style.borderTop = "none";
        header.settingEl.style.paddingTop = "0";
        header.settingEl.style.marginTop = "0";
        header.addButton((b) =>
          b.setButtonText("Sync").onClick(() => this.plugin.syncNow())
        );
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
        const flowsListHost = containerEl.createDiv({ cls: "fs-flows-list" });
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
            const total = (credits.subscription_credits ?? 0) + (credits.purchased_credits ?? 0);
            // Update collapsed header badge with total
            creditsBadge.setText(`(${total})`);
            creditsBadge.style.display = "";

            const totalSetting = new Setting(creditsHost)
              .setName("Total Credits")
              .setDesc(String(total));
            totalSetting.settingEl.style.borderTop = "none";
            totalSetting.settingEl.style.padding = "6px 0";

            const subscriptionSetting = new Setting(creditsHost)
              .setName("Subscription Credits")
              .setDesc(`${credits.subscription_credits ?? 0} (reset monthly)`);
            subscriptionSetting.settingEl.style.borderTop = "none";
            subscriptionSetting.settingEl.style.padding = "6px 0";

            const topupSetting = new Setting(creditsHost)
              .setName("Top-up Credits")
              .setDesc(`${credits.purchased_credits ?? 0} (never expire)`);
            topupSetting.settingEl.style.borderTop = "none";
            topupSetting.settingEl.style.padding = "6px 0";

            const manageSetting = new Setting(creditsHost);
            manageSetting.settingEl.style.borderTop = "none";
            manageSetting.settingEl.style.padding = "6px 0";
            manageSetting.addButton((b) =>
              b.setCta()
                .setButtonText("Manage Credits")
                .onClick(() => {
                  window.open("https://app.findflow.ai/credits", "_blank");
                })
            );
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