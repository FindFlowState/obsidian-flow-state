import { Notice, Platform, Plugin, normalizePath } from "obsidian";
import type { Job, Route } from "@flowstate/supabase-types";
import { FlowStateSettingTab, PluginSettings, DEFAULT_SETTINGS } from "./settings";
import { getSupabase, exchangeFromObsidianParams, fetchRouteById, ensureObsidianConnection } from "./supabase";
import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY, BUILD_ENV } from "./config";
import { ensureFolder, atomicWrite, writeBinaryToAttachments, sanitizePath, buildSafeNoteFilename } from "./fs";
import { downloadFromStorage } from "./storage";
import { log, warn, error } from "./logger";

export default class FlowStatePlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  statusEl: HTMLElement | null = null;
  pollIntervalId: number | null = null;
  settingsTab?: FlowStateSettingTab;
  // Internal poll intervals (seconds)
  private static readonly DESKTOP_POLL_SEC = 120;
  private static readonly MOBILE_POLL_SEC = 300;

  async onload() {
    await this.loadSettings();

    // Settings tab
    this.settingsTab = new FlowStateSettingTab(this.app, this, this.settings, async () => {
      await this.saveSettings();
    });
    this.addSettingTab(this.settingsTab);

    // Commands
    this.addCommand({
      id: "flow-state-sync-now",
      name: "Sync Now",
      callback: () => this.syncNow(),
    });

    if (BUILD_ENV === "local") {
      this.addCommand({
        id: "flow-state-reload-plugin",
        name: "Reload Flow State plugin",
        callback: async () => {
          try {
            const id = this.manifest.id;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pm = (this.app as any).plugins;
            if (!pm) {
              new Notice("Plugin manager not available");
              return;
            }
            await pm.disablePlugin(id);
            await pm.enablePlugin(id);
            new Notice("Flow State reloaded");
          } catch (e: any) {
            error("Reload failed", e);
            new Notice(`Reload error: ${e?.message ?? e}`);
          }
        }
      });
    }

    // Status bar removed per request: do not add any status bar item

    // Background poller
    this.startPoller();

    // Poll when app gains window focus (use DOM event for compatibility)
    this.registerDomEvent(window, "focus", () => this.syncNow());

    // Auth callback handler: hand off raw params to Supabase helper to build URL
    this.registerObsidianProtocolHandler(
      "flow-state-oauth",
      async (params: Record<string, string>) => {
        try {
          const supabase = getSupabase(this.settings);
          await exchangeFromObsidianParams(supabase, params, "obsidian://flow-state-oauth");
          // Register or reuse a per-vault/device Obsidian connection immediately after sign-in
          await ensureObsidianConnection(supabase, this.app);
          new Notice("Flow State: signed in");
          // Refresh settings UI to reflect signed-in state (button label + email field)
          this.settingsTab?.display();
        } catch (e: any) {
          error("OAuth exchange failed", e);
          new Notice(`Flow State OAuth error: ${e?.message ?? e}`);
        }
      }
    );
  }

  onunload() {
    if (this.pollIntervalId) {
      window.clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  setStatus(txt: string) {
    if (this.statusEl) this.statusEl.setText(`Flow State: ${txt}`);
  }

  isMobile(): boolean {
    return Platform.isMobile; // OS-limited backgrounding expected
  }

  getIntervalMs(): number {
    const sec = this.isMobile() ? FlowStatePlugin.MOBILE_POLL_SEC : FlowStatePlugin.DESKTOP_POLL_SEC;
    return Math.max(15, sec) * 1000; // guard minimum
  }

  startPoller() {
    if (this.pollIntervalId) window.clearInterval(this.pollIntervalId);
    const ms = this.getIntervalMs();
    this.pollIntervalId = window.setInterval(() => {
      this.syncNow().catch((e) => warn("Background sync failed:", e));
    }, ms);
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.startPoller();
  }

  async syncNow() {
    try {
      const hasUrl = !!(this.settings.supabaseUrl || DEFAULT_SUPABASE_URL);
      const hasKey = !!(this.settings.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY);
      if (!hasUrl || !hasKey) {
        new Notice("Flow State: configure Supabase in settings");
        return;
      }
      this.setStatus("Syncing...");
      const written = await this.syncOnce();
      this.setStatus(`delivered ${written} item${written === 1 ? "" : "s"}`);
    } catch (e: any) {
      error("Sync error", e);
      this.setStatus("Error");
      new Notice(`Flow State sync error: ${e?.message ?? e}`);
    }
  }

  async syncOnce(): Promise<number> {
    const supabase = getSupabase(this.settings);

    // Single-query join to filter Obsidian routes (only active routes)
    const { data: items, error: jErr } = await supabase
      .from("jobs")
      .select(`*, routes!inner(*, connections!inner(service_type))`)
      .eq("status", "transcribed")
      .eq("routes.is_active", true)
      .eq("routes.connections.service_type", "obsidian")
      .order("created_at", { ascending: true })
      .limit(10);

    if (jErr) throw jErr;
    log(`syncOnce: fetched ${items?.length ?? 0} job(s)`);

    let writeCount = 0;
    for (const it of items ?? []) {
      log(`syncOnce: processing job ${it.id} route=${it.route_id}`);
      const content = it.formatted_content || it.transcribed_text;
      if (!content) throw new Error(`Missing formatted_content for job ${it.id}`);

      const writtenPath = await this.writeJobToVault(it, content);
      log(`syncOnce: wrote job ${it.id} to ${writtenPath}`);

      // Ack update guarded by status
      const destination_url = `obsidian://open?file=${encodeURIComponent(writtenPath)}`;
      const { error: uErr } = await supabase
        .from("jobs")
        .update({ status: "delivered", destination_url })
        .eq("id", it.id)
        .eq("status", "transcribed");
      if (uErr) throw uErr;
      log(`syncOnce: acked job ${it.id} as delivered -> ${destination_url}`);

      writeCount += 1;
    }

    return writeCount;
  }

  async writeJobToVault(it: Job, body: string): Promise<string> {
    const app = this.app;
    const routeId = it.route_id;
    if (!routeId) throw new Error(`Job ${it.id} missing route_id`);

    // Resolve and cache full Route row
    let route: Route | undefined = this.settings.routes?.[routeId];
    const needsRefresh = (r?: Route) => {
      if (!r) return true;
      if (!r.destination_location || !String(r.destination_location).trim()) return true;
      if ((r as any).include_original_file == null) return true;
      return false;
    };
    const refresh = needsRefresh(route);
    if (refresh) {
      log(`writeJobToVault: refreshing route ${routeId} from Supabase (stale or missing required fields)`);
      const supabase = getSupabase(this.settings);
      const row = await fetchRouteById(supabase, routeId);
      if (!row) throw new Error(`Route ${routeId} not found`);
      route = row;
      this.settings.routes = this.settings.routes || {};
      this.settings.routes[routeId] = route;
      await this.saveSettings();
    } else {
      log(`writeJobToVault: using cached route ${routeId}`);
    }
    const destinationLocation = normalizePath(route!.destination_location!.trim());
    const appendMode = !!(route as any).append_to_existing;
    const includeOriginal = (route as any).include_original_file as boolean | null | undefined;
    log(`writeJobToVault: route fields dest="${destinationLocation}" appendMode=${appendMode} includeOriginal=${includeOriginal}`);

    // Required fields must exist on the Route row (post-refresh)
    if (includeOriginal == null) throw new Error(`Route ${routeId} missing include_original_file`);

    // Ensure destination container exists
    if (appendMode) {
      const parent = destinationLocation.split("/").slice(0, -1).join("/") || "";
      if (parent) {
        log(`writeJobToVault: ensuring parent folder ${parent}`);
        await ensureFolder(app, parent);
      }
    } else {
      log(`writeJobToVault: ensuring destination folder ${destinationLocation}`);
      await ensureFolder(app, destinationLocation);
    }

    // Determine destination folder for attachments
    const destFolder = appendMode
      ? (destinationLocation.endsWith(".md")
          ? destinationLocation.split("/").slice(0, -1).join("/")
          : destinationLocation)
      : destinationLocation;

    // Optional attachment download and embed
    let attachmentSection = "";
    if (includeOriginal) {
      try {
        const attachmentPath = await this.maybeDownloadOriginal(it, destFolder);
        if (attachmentPath) {
          const fileName = attachmentPath.split("/").pop();
          // If image/audio and you prefer embed: `![[${fileName}]]`
          attachmentSection = `\n\n![[${attachmentPath}]]\n\n`;
          log(`writeJobToVault: embedded attachment ${fileName} at ${attachmentPath}`);
        }
      } catch (e) {
        warn("Attachment download failed, continuing without attachment:", e);
      }
    }

    // Compose final content. When appending, include a heading derived from final_title/original filename.
    let content = "";
    if (appendMode) {
      const baseTitle = it.final_title || (it.original_filename ? it.original_filename.replace(/\.[^/.]+$/, '') : 'Untitled');
      const safeTitle = baseTitle.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, ' ');
      const heading = `# ${safeTitle}`;
      content = `${heading}\n\n${body}${attachmentSection}`;
    } else {
      content = `${body}${attachmentSection}`;
    }

    if (appendMode) {
      // destinationLocation is a file path to append into
      const filePath = destinationLocation.endsWith(".md") ? destinationLocation : `${destinationLocation}.md`;
      const exists = await app.vault.adapter.exists(filePath);
      if (exists) {
        const f = this.app.vault.getAbstractFileByPath(filePath);
        if (f && (f as any).extension !== undefined) {
          // TFile
          const tf = f as any;
          const existing = await this.app.vault.read(tf);
          const combined = existing ? `${existing}\n\n${content}` : content;
          await this.app.vault.modify(tf, combined);
          log(`writeJobToVault: appended to existing file ${filePath}`);
          return filePath;
        }
      }
      // Create new file if not exists
      await atomicWrite(app, filePath, content);
      log(`writeJobToVault: created new file ${filePath}`);
      return filePath;
    } else {
      // Always use backend-provided final_title (fallback to original filename) for new files
      const baseName = it.final_title || (it.original_filename ? it.original_filename.replace(/\.[^/.]+$/, '') : 'Untitled');
      const relName = buildSafeNoteFilename(baseName, 120);
      const relPath = `${destinationLocation}/${relName}`;

      // Conflict handling for new files
      const finalPath = await this.resolveConflictPath(relPath);
      await atomicWrite(app, finalPath, content);
      log(`writeJobToVault: wrote new file ${finalPath}`);
      return finalPath;
    }
  }

  async resolveConflictPath(targetPath: string): Promise<string> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(targetPath))) return targetPath;
    // Rename behavior only: Filename 1.md, Filename 2.md, ...
    const extIndex = targetPath.lastIndexOf(".");
    const base = extIndex >= 0 ? targetPath.slice(0, extIndex) : targetPath;
    const ext = extIndex >= 0 ? targetPath.slice(extIndex) : "";
    let i = 1;
    while (await adapter.exists(`${base} ${i}${ext}`)) i++;
    return `${base} ${i}${ext}`;
  }

  async maybeDownloadOriginal(it: Job & { original_file_url?: string; metadata?: any }, baseFolder?: string): Promise<string | null> {
    log('maybeDownloadOriginal: starting for job', it.id);
    const meta = (it as any).metadata ?? {};
    log('maybeDownloadOriginal: metadata', JSON.stringify(meta, null, 2));
    
    let bucket: string | null = null;
    let name: string | null = null;
    let fileUrl: string | null = null;

    // Check for direct URL on the job object first
    if (it.original_file_url) {
      fileUrl = it.original_file_url;
      log('maybeDownloadOriginal: using original_file_url from job', fileUrl);
    }
    // Fall back to metadata
    else if (meta?.original_object?.bucket && meta?.original_object?.name) {
      log('maybeDownloadOriginal: using original_object from metadata');
      bucket = meta.original_object.bucket;
      name = meta.original_object.name;
    } 
    else if (meta?.original_file_url) {
      fileUrl = meta.original_file_url;
      log('maybeDownloadOriginal: using original_file_url from metadata', fileUrl);
    }

    // If we have a file URL, try to parse it
    if (fileUrl) {
      try {
        // Handle kong URL by replacing with localhost
        const normalizedUrl = fileUrl.replace('http://kong:8000', 'http://127.0.0.1:54321');
        const url = new URL(normalizedUrl);
        
        // Check if this is a storage URL
        const storageMatch = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
        if (storageMatch) {
          bucket = storageMatch[1];
          name = storageMatch[2];
          log('maybeDownloadOriginal: parsed storage URL', { bucket, name });
        } else {
          // If not a storage URL, try to download directly
          log('maybeDownloadOriginal: downloading file directly from URL', normalizedUrl);
          const response = await fetch(normalizedUrl);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          
          const data = await response.arrayBuffer();
          const fileName = fileUrl.split('/').pop() || 'original';
          const savedPath = await writeBinaryToAttachments(this.app, fileName, new Uint8Array(data));
          log('maybeDownloadOriginal: saved file from direct URL', savedPath);
          return savedPath;
        }
      } catch (e) {
        log('maybeDownloadOriginal: error processing URL', e);
      }
    }

    if (!bucket || !name) {
      log('maybeDownloadOriginal: missing bucket or name, cannot download');
      return null;
    }

    try {
      log('maybeDownloadOriginal: downloading from storage', { bucket, name });
      const supabase = getSupabase(this.settings);
      const data = await downloadFromStorage(supabase, bucket, name);
      const filename = name.split("/").pop() || "original";
      log('maybeDownloadOriginal: saving attachment', { filename, size: data?.byteLength });
      const savedPath = await writeBinaryToAttachments(this.app, filename, data);
      log('maybeDownloadOriginal: saved attachment to', savedPath);
      return savedPath;
    } catch (e) {
      log('maybeDownloadOriginal: error downloading/saving attachment', e);
      return null;
    }
  }
}
