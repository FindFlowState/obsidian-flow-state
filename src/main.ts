import { Notice, Platform, Plugin, normalizePath } from "obsidian";
import type { Job, Route } from "@flowstate/supabase-types";
import { FlowStateSettingTab, PluginSettings, DEFAULT_SETTINGS } from "./settings";
import { getSupabase, exchangeFromObsidianParams, fetchRouteById, ensureObsidianConnection } from "./supabase";
import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY, BUILD_ENV } from "./config";
import { ensureFolder, atomicWrite, writeBinaryToAttachments, sanitizePath, buildSafeNoteFilename } from "./fs";
import { downloadFromStorage } from "./storage";
import { log, warn, error } from "./logger";
import { initSentry, captureException } from "./sentry";

export default class FlowStatePlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  statusEl: HTMLElement | null = null;
  pollIntervalId: number | null = null;
  settingsTab?: FlowStateSettingTab;
  // Internal poll intervals (seconds)
  private static readonly DESKTOP_POLL_SEC = 120;
  private static readonly MOBILE_POLL_SEC = 300;
  // Sync lock to prevent concurrent syncs
  private isSyncing = false;
  // Cooldown for "not signed in" notice to prevent spam (ms)
  private static readonly NOT_SIGNED_IN_COOLDOWN_MS = 3000;
  private lastNotSignedInNotice = 0;
  // Suppress focus-triggered sync briefly after deep link sync or plugin load (ms)
  private static readonly FOCUS_SYNC_COOLDOWN_MS = 3000;
  private lastSyncCooldownStart = 0;

  async onload() {
    // Initialize Sentry error tracking (prod builds only)
    initSentry();

    // Set cooldown to prevent focus-triggered sync on startup
    // This gives time for deep link handlers to run first
    this.lastSyncCooldownStart = Date.now();

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


    // Status bar removed per request: do not add any status bar item

    // Background poller
    this.startPoller();

    // Poll when app gains window focus (use DOM event for compatibility)
    // Use silent mode to avoid "not signed in" notice during OAuth flow
    // Skip if recently started or deep link sync triggered (to avoid duplicate syncs)
    this.registerDomEvent(window, "focus", () => {
      const timeSinceCooldown = Date.now() - this.lastSyncCooldownStart;
      if (timeSinceCooldown < FlowStatePlugin.FOCUS_SYNC_COOLDOWN_MS) {
        log("focus sync skipped: within cooldown period", { timeSinceCooldown });
        return;
      }
      this.syncNow(true);
    });

    // Unified deep link handler: obsidian://flow-state
    // Supports:
    //   - OAuth callback (hash with tokens, or code param)
    //   - ?cmd=sync (trigger sync and open last synced note)
    //   - ?cmd=new-project (open Add Project screen)
    //   - ?project=<id> (open project editor)
    //   - (default) open plugin settings
    // Note: Can't use "action" param - Obsidian automatically sets it to the handler name
    this.registerObsidianProtocolHandler(
      "flow-state",
      async (params: Record<string, string>) => {
        log("deep-link handler triggered", params);

        // Handle OAuth callback (Magic Link with hash tokens, or PKCE with code)
        const hash = params["hash"] ?? "";
        const hasOAuthTokens = hash.includes("access_token=") && hash.includes("refresh_token=");
        const hasOAuthCode = !!params["code"];

        if (hasOAuthTokens || hasOAuthCode) {
          try {
            const supabase = getSupabase(this.settings);
            await exchangeFromObsidianParams(supabase, params, "obsidian://flow-state");
            await ensureObsidianConnection(supabase, this.app);
            this.settingsTab?.display();
          } catch (e: any) {
            error("OAuth exchange failed", e);
            new Notice(`FlowState OAuth error: ${e?.message ?? e}`);
          }
          return;
        }

        // Handle sync action - sync and open file
        // ?cmd=sync - sync and open last synced note
        // ?cmd=sync&job=<id> - sync and open specific job's file
        // Note: Can't use "action" param - Obsidian sets it to the handler name
        if (params.cmd === "sync") {
          // Set cooldown to suppress focus-triggered sync
          this.lastSyncCooldownStart = Date.now();
          const targetJobId = params.job;
          log("deep-link sync: starting", { targetJobId, isSyncing: this.isSyncing });

          // If another sync is in progress, wait for it to complete
          if (this.isSyncing) {
            log("deep-link sync: waiting for in-progress sync to complete");
            let waitCount = 0;
            while (this.isSyncing && waitCount < 30) {
              await new Promise(resolve => setTimeout(resolve, 500));
              waitCount++;
            }
            log("deep-link sync: done waiting", { waitCount, isSyncing: this.isSyncing });
          }

          // Now try our sync
          const result = await this.syncWithLogs();
          log("deep-link sync: result", {
            success: result.success,
            entriesCount: result.entries.length,
            jobsFound: result.jobsFound,
            error: result.error
          });

          // If we got entries, use those
          if (result.entries.length > 0) {
            let pathToOpen: string | null = null;

            if (targetJobId) {
              const entry = result.entries.find(e => e.jobId === targetJobId);
              if (entry) {
                pathToOpen = entry.path;
              }
              log("deep-link sync: target job lookup", { targetJobId, found: !!entry, pathToOpen });
            }

            if (!pathToOpen) {
              pathToOpen = result.entries[result.entries.length - 1].path;
              log("deep-link sync: using last entry", { pathToOpen });
            }

            // Normalize path to handle legacy "//filename" paths
            while (pathToOpen.startsWith("/")) {
              pathToOpen = pathToOpen.slice(1);
            }
            log("deep-link sync: opening file", { pathToOpen });
            await this.app.workspace.openLinkText(pathToOpen, "", false);
          } else if (targetJobId) {
            // No entries from our sync - maybe another sync already delivered it
            // Check the database for the delivered job's destination_url
            log("deep-link sync: no entries, checking if job was already delivered");
            try {
              const supabase = getSupabase(this.settings);
              const { data: job } = await supabase
                .from("jobs")
                .select("destination_url, status")
                .eq("id", targetJobId)
                .single();

              if (job?.status === "delivered" && job?.destination_url) {
                // Extract file path from obsidian://open?file=... URL
                const match = job.destination_url.match(/file=([^&]+)/);
                if (match) {
                  // Normalize path to handle legacy "//filename" paths
                  let filePath = decodeURIComponent(match[1]);
                  while (filePath.startsWith("/")) {
                    filePath = filePath.slice(1);
                  }
                  log("deep-link sync: opening already-delivered file", { filePath });
                  await this.app.workspace.openLinkText(filePath, "", false);
                }
              } else {
                log("deep-link sync: job not delivered or no destination_url", { job });
              }
            } catch (e) {
              error("deep-link sync: failed to check job status", e);
            }
          } else {
            log("deep-link sync: no entries to open");
          }
          return;
        }

        // Handle new-project action - open Add Project screen
        // Note: Can't use "action" param - Obsidian sets it to the handler name
        if (params.cmd === "new-project") {
          try {
            const setting = (this.app as any).setting;
            await setting.open();
            setting.openTabById(this.manifest.id);
            this.settingsTab?.openNewProject();
          } catch (e: any) {
            error("Failed to open new project screen", e);
            new Notice(`FlowState: ${e?.message ?? e}`);
          }
          return;
        }

        // Default: open plugin settings with optional project edit
        try {
          const projectId = params.project;

          const setting = (this.app as any).setting;
          await setting.open();
          setting.openTabById(this.manifest.id);

          // Fetch and open project editor if projectId provided
          // Do this AFTER opening settings to avoid race with openTabById's internal display() call
          if (projectId && this.settingsTab) {
            const supabase = getSupabase(this.settings);
            const route = await fetchRouteById(supabase, projectId);
            if (route) {
              this.settingsTab.openProjectEditor(route);
            } else {
              new Notice("Project not found");
            }
          }
        } catch (e: any) {
          error("Failed to open settings", e);
          new Notice(`FlowState: ${e?.message ?? e}`);
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
    if (this.statusEl) this.statusEl.setText(`FlowState: ${txt}`);
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
      this.syncNow(true).catch((e) => warn("Background sync failed:", e));
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

  async syncNow(silent = false) {
    await this.syncNowAndGetPaths(silent);
  }

  /** Sync with detailed logging for settings UI */
  async syncWithLogs(): Promise<{ success: boolean; entries: { timestamp: Date; path: string; title: string; jobId: string }[]; error?: string; jobsFound: number }> {
    if (this.isSyncing) {
      return { success: false, entries: [], error: "Sync already in progress", jobsFound: 0 };
    }
    this.isSyncing = true;

    try {
      const hasUrl = !!(this.settings.supabaseUrl || DEFAULT_SUPABASE_URL);
      const hasKey = !!(this.settings.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY);
      if (!hasUrl || !hasKey) {
        return { success: false, entries: [], error: "Supabase not configured", jobsFound: 0 };
      }

      const supabase = getSupabase(this.settings);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        return { success: false, entries: [], error: "Not signed in", jobsFound: 0 };
      }

      this.setStatus("Syncing...");
      const { entries, jobsFound } = await this.syncOnceWithDetails();
      this.setStatus(`delivered ${entries.length} item${entries.length === 1 ? "" : "s"}`);
      return { success: true, entries, jobsFound };
    } catch (e: any) {
      error("Sync error", e);
      captureException(e, { context: "syncWithLogs" });
      this.setStatus("Error");
      return { success: false, entries: [], error: e?.message ?? String(e), jobsFound: 0 };
    } finally {
      this.isSyncing = false;
    }
  }

  /** Sync and return array of written file paths. Pass silent=true for background syncs to suppress notices. */
  async syncNowAndGetPaths(silent = false): Promise<string[]> {
    // Prevent concurrent syncs
    if (this.isSyncing) {
      log("syncNow: already syncing, skipping");
      return [];
    }
    this.isSyncing = true;

    try {
      const hasUrl = !!(this.settings.supabaseUrl || DEFAULT_SUPABASE_URL);
      const hasKey = !!(this.settings.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY);
      if (!hasUrl || !hasKey) {
        if (!silent) new Notice("FlowState: configure Supabase in settings");
        return [];
      }

      // Check if user is signed in
      const supabase = getSupabase(this.settings);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // Only show notice for explicit (non-silent) syncs
        if (!silent) {
          new Notice("FlowState: No account signed in");
        }
        return [];
      }

      this.setStatus("Syncing...");
      const paths = await this.syncOnce();
      this.setStatus(`delivered ${paths.length} item${paths.length === 1 ? "" : "s"}`);
      return paths;
    } catch (e: any) {
      error("Sync error", e);
      captureException(e, { context: "syncNow" });
      this.setStatus("Error");
      new Notice(`FlowState sync error: ${e?.message ?? e}`);
      return [];
    } finally {
      this.isSyncing = false;
    }
  }

  async syncOnce(): Promise<string[]> {
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

    const writtenPaths: string[] = [];
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

      writtenPaths.push(writtenPath);
    }

    return writtenPaths;
  }

  /** Sync with detailed entry info for logging */
  async syncOnceWithDetails(): Promise<{ entries: { timestamp: Date; path: string; title: string; jobId: string }[]; jobsFound: number }> {
    const supabase = getSupabase(this.settings);

    const { data: items, error: jErr } = await supabase
      .from("jobs")
      .select(`*, routes!inner(*, connections!inner(service_type))`)
      .eq("status", "transcribed")
      .eq("routes.is_active", true)
      .eq("routes.connections.service_type", "obsidian")
      .order("created_at", { ascending: true })
      .limit(10);

    if (jErr) throw jErr;
    const jobsFound = items?.length ?? 0;
    log(`syncOnceWithDetails: fetched ${jobsFound} job(s)`);

    const entries: { timestamp: Date; path: string; title: string; jobId: string }[] = [];
    for (const it of items ?? []) {
      log(`syncOnceWithDetails: processing job ${it.id} route=${it.route_id}`);
      const content = it.formatted_content || it.transcribed_text;
      if (!content) throw new Error(`Missing formatted_content for job ${it.id}`);

      const writtenPath = await this.writeJobToVault(it, content);
      log(`syncOnceWithDetails: wrote job ${it.id} to ${writtenPath}`);

      const destination_url = `obsidian://open?file=${encodeURIComponent(writtenPath)}`;
      const { error: uErr } = await supabase
        .from("jobs")
        .update({ status: "delivered", destination_url })
        .eq("id", it.id)
        .eq("status", "transcribed");
      if (uErr) throw uErr;

      entries.push({
        timestamp: new Date(),
        path: writtenPath,
        title: it.final_title || it.original_filename || writtenPath.split("/").pop() || "Untitled",
        jobId: it.id,
      });
    }

    return { entries, jobsFound };
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
      // Handle root destination "/" specially to avoid "//filename.md" paths
      const relPath = destinationLocation === "/" || destinationLocation === ""
        ? relName
        : normalizePath(`${destinationLocation}/${relName}`);

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
