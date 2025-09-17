import { App, PluginSettingTab, Setting, Notice, ButtonComponent } from "obsidian";
import type FlowStatePlugin from "./main";
import type { Route } from "@flowstate/supabase-types";
import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY } from "./config";
import { getSupabase, getCurrentSession, signOut as supaSignOut, sendMagicLink, listObsidianRoutes, deleteRoute, fetchRouteById } from "./supabase";
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
  constructor(
    app: App,
    private plugin: FlowStatePlugin,
    private settings: PluginSettings,
    private onSave?: () => Promise<void>
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const titleEl = containerEl.createEl("h1", { text: "Flow State" });
    titleEl.style.marginBottom = "8px";
    // Link to sign up / account creation (style like a description)
    const intro = containerEl.createEl("div");
    intro.createEl("a", { text: "Flow State", href: "https://flowstate.example.com" });
    intro.appendText(
      " converts handwritten notes and audio recordings into Obsidian notes."
    );
    intro.style.fontSize = "0.85em";
    // intro.style.color = "var(--text-muted)";
    intro.style.marginBottom = "24px";
    
    // Unified connect section: email + connect/logout button
    // Place both rows inside a fixed wrapper so async rendering preserves order
    let emailValue = "";
    const authSection = containerEl.createDiv();
    const connectSetting = new Setting(authSection)
      .setName("Connect");
    connectSetting.setDesc("Enter your Flow State account email");

    (async () => {
      try {
        const supabase = getSupabase(this.settings);
        const session = await getCurrentSession(supabase);
        const isSignedIn = !!session;
        // Remember current user id for cache filtering on next open
        const currentUid = session?.user?.id ?? "";
        if (currentUid && this.settings.lastUserId !== currentUid) {
          this.settings.lastUserId = currentUid;
          await this.plugin.saveData(this.settings);
        }

        // Create email field within the same setting row
        connectSetting.addText((t) => {
            const signedInEmail = session?.user?.email ?? "";
            if (isSignedIn) {
              t.setValue(signedInEmail);
              t.setDisabled(true);
              emailValue = signedInEmail;
            } else {
              t.setPlaceholder("you@example.com");
              t.onChange((v) => { emailValue = v.trim(); });
            }
          });
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
            empty.setText("No projects yet. Click 'Add Project' to create one.");
            return;
          }
          for (const r of routes) {
            const ui = new Setting(flowsListHost)
              .setName(r.name)
              .setDesc(`Destination: ${r.destination_location}`);
            (ui as any).settingEl.style.borderTop = "none";
            (ui as any).settingEl.style.padding = "6px 0";
            if ((ui as any).nameEl) (ui as any).nameEl.style.fontSize = "1.0em";
            if ((ui as any).descEl) (ui as any).descEl.style.color = "var(--text-muted)";
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
              b.setButtonText("Delete");
              const el = b.buttonEl;
              el.style.background = "transparent";
              el.style.border = "1px solid var(--color-red)";
              el.style.color = "var(--text-normal)";
              b.onClick(async () => {
                const ok = window.confirm(`Delete project "${r.name}"? This cannot be undone.`);
                if (!ok) return;
                try {
                  const supa = getSupabase(this.settings);
                  await deleteRoute(supa, r.id);
                  if (this.settings.routes) delete this.settings.routes[r.id];
                  await this.plugin.saveData(this.settings);
                  new Notice("Project deleted");
                  this.display();
                } catch (e: any) {
                  console.error(e);
                  new Notice(e?.message ?? String(e));
                }
              });
            });
          }
          const actions = flowsListHost.createDiv({ cls: "fs-flows-actions" });
          actions.style.display = "flex";
          actions.style.justifyContent = "flex-end";
          actions.style.marginTop = "12px";
          const syncBtn = actions.createEl("button", { text: "Sync" });
          syncBtn.addEventListener("click", () => this.plugin.syncNow());
        };

        // Render from cache immediately (only projects belonging to the last known user)
        const uid = this.settings.lastUserId || null;
        const cachedAll = Object.values(this.settings.routes || {});
        const cachedForUser = uid
          ? cachedAll.filter((r: any) => r.user_id === uid)
          : [];
        if (cachedForUser.length > 0) {
          renderRows(cachedForUser as Route[]);
        } else {
          const loading = flowsListHost.createDiv({ cls: "setting-item-description" });
          loading.setText("Loading projects…");
        }

        // Fetch fresh from Supabase, update cache, and re-render
        const rows: Route[] = await listObsidianRoutes(supabase);
        const valid: Route[] = [];
        for (const r of rows) {
          try {
            const folder = r.destination_location?.trim();
            if (!folder) throw new Error("Missing destination_location");
            valid.push(r);
            this.settings.routes = this.settings.routes || {};
            this.settings.routes[r.id] = r;
          } catch (e) {
            console.warn("Skipping project due to invalid destination:", r.id, e);
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
        renderRows(valid);
      } catch (e) {
        console.error(e);
      }
    })();
    // Removed global destination/template and conflict/interval controls; use per-flow configuration instead
  }
}