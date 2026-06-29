import { App, ButtonComponent, Notice, Setting, AbstractInputSuggest, TFolder, TFile, normalizePath } from "obsidian";
import type FlowStatePlugin from "./main";
import type { Route } from "./types";
import { getSupabase, createProject, updateRoute } from "./supabase";
import { DEFAULT_INGEST_EMAIL_DOMAIN } from "./config";
import { ensureFolder, atomicWrite } from "./fs";
import { errorMessage } from "./logger";

// Inline folder typeahead using Obsidian's AbstractInputSuggest
class FolderInputSuggest extends AbstractInputSuggest<TFolder> {
  private onChoose: (f: TFolder) => void;
  constructor(app: App, public inputEl: HTMLInputElement, onChoose: (f: TFolder) => void) {
    super(app, inputEl);
    this.onChoose = onChoose;
  }
  getSuggestions(query: string): TFolder[] {
    const q = query.toLowerCase();
    const all = this.app.vault.getAllLoadedFiles();
    const items = all.filter((f): f is TFolder => f instanceof TFolder)
      .map((f) => {
        const path = f.path.toLowerCase();
        const base = path.split("/").pop() || path;
        // Simple relevance scoring
        let score = 0;
        if (!q) score = 1; // show something when empty
        else if (base === q) score = 100;
        else if (base.startsWith(q)) score = 90;
        else if (path.startsWith(q)) score = 80;
        else if (base.includes(q)) score = 70;
        else if (path.includes(q)) score = 60;
        // Prefer shorter paths for the same score
        return { f, score, len: path.length };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => (b.score - a.score) || (a.len - b.len))
      .map((x) => x.f);
    return items;
  }
  renderSuggestion(value: TFolder, el: HTMLElement): void {
    el.setText(value.path);
  }
  selectSuggestion(value: TFolder, evt: MouseEvent | KeyboardEvent): void {
    this.inputEl.value = value.path;
    this.onChoose(value);
    // Notify listeners of value change
    this.inputEl.dispatchEvent(new Event('input'));
    this.close();
    // Force dropdown to disappear in some Obsidian builds
    this.inputEl.blur();
    window.setTimeout(() => this.inputEl.focus(), 0);
  }
}

// Inline file typeahead
class FileInputSuggest extends AbstractInputSuggest<TFile> {
  private onChoose: (f: TFile) => void;
  constructor(app: App, public inputEl: HTMLInputElement, onChoose: (f: TFile) => void) {
    super(app, inputEl);
    this.onChoose = onChoose;
  }
  getSuggestions(query: string): TFile[] {
    const q = query.toLowerCase();
    const all = this.app.vault.getAllLoadedFiles();
    const items = all.filter((f): f is TFile => f instanceof TFile)
      .map((f) => {
        const path = f.path.toLowerCase();
        const base = path.split("/").pop() || path;
        let score = 0;
        if (!q) score = 1;
        else if (base === q) score = 100;
        else if (base.startsWith(q)) score = 90;
        else if (path.startsWith(q)) score = 80;
        else if (base.includes(q)) score = 70;
        else if (path.includes(q)) score = 60;
        return { f, score, len: path.length };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => (b.score - a.score) || (a.len - b.len))
      .map((x) => x.f);
    return items;
  }
  renderSuggestion(value: TFile, el: HTMLElement): void { el.setText(value.path); }
  selectSuggestion(value: TFile, evt: MouseEvent | KeyboardEvent): void {
    this.inputEl.value = value.path;
    this.onChoose(value);
    this.inputEl.dispatchEvent(new Event('input'));
    this.close();
    this.inputEl.blur();
    window.setTimeout(() => this.inputEl.focus(), 0);
  }
}

export function renderRouteEditor(
  containerEl: HTMLElement,
  app: App,
  plugin: FlowStatePlugin,
  existing: Route | null,
  onBack: () => void,
  onSaved: (route: Route) => Promise<void> | void,
) {
  // Helper to widen input area in a Setting row
  const applyWideControl = (s: Setting) => {
    // Expand the control container
    s.controlEl.addClass("fs-wide-control");
  };

  // Local state
  let name = existing?.name ?? "";
  let destinationFolder = existing?.destination_location ?? "";
  let includeOriginalFile = existing?.include_original_file ?? true;
  const destConfig = (existing?.destination_config ?? {}) as Record<string, unknown>;
  let embedOriginal = destConfig.embed_original !== false; // default true
  let appendToExisting = existing?.append_to_existing ?? false;
  let customInstructions = existing?.custom_instructions ?? "";
  let aiTitleInstructions = existing?.ai_title_instructions ?? "";
  let slug = existing?.slug ?? "";
  let userHandle = "";
  // Remember last choices per mode so toggling append restores previous value
  let lastFilePathSelected: string | null = appendToExisting ? (destinationFolder || null) : null;
  let lastFolderPathSelected: string | null = !appendToExisting ? (destinationFolder || null) : null;

  const emailDomain = DEFAULT_INGEST_EMAIL_DOMAIN;
  const slugify = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
  const normalizeHandle = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-");
  const computeEmail = () => (userHandle && slug && emailDomain ? `${userHandle}.${slug}@${emailDomain}` : "");

  // Back (Esc) + Title row
  const headerRow = containerEl.createDiv({ cls: "fs-editor-header" });
  const backBtnEl = headerRow.createEl("button", { text: "←" });
  backBtnEl.addClass("fs-back-btn");
  backBtnEl.addEventListener("click", () => onBack());
  const keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") { onBack(); } };
  window.addEventListener("keydown", keyHandler, { once: true });
  const titleText = existing ? `Edit Flow: ${existing.name}` : "Add Flow";
  const title = headerRow.createEl("h2", { text: titleText });
  title.addClass("fs-editor-title");

  // Name
  const nameSetting = new Setting(containerEl)
    .setName("Name")
    .addText((t) => {
      t.setPlaceholder("Journal Entries").setValue(name).onChange((v) => name = v);
      t.inputEl.addClass("fs-full-width");
    });
  applyWideControl(nameSetting);

  // Content type selection removed; processing determines type from MIME

  // Foldable sections helper (default closed) with arrow indicator and extra spacing
  const addFoldableSection = (parent: HTMLElement, heading: string) => {
    const section = parent.createDiv({ cls: "fs-foldable-section" });
    const header = section.createEl("div", { cls: "fs-section-header" });
    const arrow = header.createEl("span", { text: "▸" });
    header.createEl("span", { text: heading });
    const body = section.createDiv({ cls: "fs-section-body" });
    let open = false;
    const update = () => {
      body.toggleClass("fs-hidden", !open);
      arrow.textContent = open ? "▾" : "▸";
    };
    header.addEventListener("click", () => { open = !open; update(); });
    update();
    return { section, header, body, setOpen: (v: boolean) => { open = v; update(); } };
  };

  // Save Options (foldable, open by default) — holds destination + save settings
  const saveOptsFold = addFoldableSection(containerEl, "Save Options");
  saveOptsFold.setOpen(true);

  // Append toggle
  let destinationSetting: Setting;
  let updateTitleInstrLabel: () => void;
  new Setting(saveOptsFold.body)
    .setName("Append to existing")
    .setDesc("If enabled, we'll add your transcriptions to an existing note. New headings will be created for each upload.")
    .addToggle((tg) => tg.setValue(appendToExisting).onChange((v) => {
      appendToExisting = v;
      destinationSetting.setName(appendToExisting ? "Destination File" : "Destination Folder");
      // Restore the last selection for that mode (or clear if none)
      destinationFolder = appendToExisting
        ? (lastFilePathSelected ?? "")
        : (lastFolderPathSelected ?? "");
      // Rebuild control so correct suggester attaches
      rebuildDestinationControl();
      // Update title-related labels
      if (updateTitleInstrLabel) updateTitleInstrLabel();
    }));

  // Destination (inline typeahead with dynamic mode)
  destinationSetting = new Setting(saveOptsFold.body).setName(appendToExisting ? "Destination File" : "Destination Folder");
  let destinationInputEl: HTMLInputElement;
  let destinationSuggest: AbstractInputSuggest<unknown> | null = null;
  const setupDestinationSuggest = () => {
    if (!destinationInputEl) return;
    if (destinationSuggest) { destinationSuggest.close(); destinationSuggest = null; }
    destinationInputEl.placeholder = appendToExisting ? "Type to search files…" : "Type to search folders…";
    destinationSuggest = appendToExisting
      ? new FileInputSuggest(app, destinationInputEl, (file) => {
          destinationFolder = file.path;
          destinationInputEl.value = destinationFolder;
          lastFilePathSelected = destinationFolder;
          // Rebuild to fully teardown suggester so popup cannot linger
          window.setTimeout(() => {
            rebuildDestinationControl();
          }, 0);
        })
      : new FolderInputSuggest(app, destinationInputEl, (folder) => {
          destinationFolder = folder.path;
          destinationInputEl.value = destinationFolder;
          lastFolderPathSelected = destinationFolder;
          window.setTimeout(() => {
            rebuildDestinationControl();
          }, 0);
        });
  };
  const rebuildDestinationControl = () => {
    // Remove existing input and build a fresh one so AbstractInputSuggest attaches cleanly
    destinationSetting.controlEl.empty();
    const input = destinationSetting.controlEl.createEl("input", { type: "text" });
    input.addClass("fs-destination-input");
    input.value = destinationFolder;
    input.placeholder = appendToExisting ? "Type to search files…" : "Type to search folders…";
    input.addEventListener("input", (e) => {
      destinationFolder = (e.target as HTMLInputElement).value;
      // Opportunistically remember typed value per mode
      if (appendToExisting) lastFilePathSelected = destinationFolder;
      else lastFolderPathSelected = destinationFolder;
    });
    destinationInputEl = input;
    setupDestinationSuggest();
  };
  // Initial build
  rebuildDestinationControl();
  applyWideControl(destinationSetting);

  // Title Instructions (dynamic name/desc based on append mode)
  const titleInstrSetting = new Setting(saveOptsFold.body)
    .addTextArea((ta) => {
      ta.setValue(aiTitleInstructions).onChange((v) => aiTitleInstructions = v);
      ta.inputEl.rows = 2;
      ta.inputEl.addClass("fs-full-width");
      ta.setPlaceholder("e.g., Keep it short and descriptive");
    });
  updateTitleInstrLabel = () => {
    titleInstrSetting.setName(appendToExisting ? "Note Heading Instructions" : "File Name Instructions");
    titleInstrSetting.setDesc(
      appendToExisting
        ? "We name headings automatically. But if you have your own preferences, describe 'em here!"
        : "We name your files automatically. But if you have your own preferences, describe 'em here!"
    );
  };
  updateTitleInstrLabel();
  applyWideControl(titleInstrSetting);

  // Embed Preview toggle (shown only when Download Original is on)
  let embedToggleSetting: Setting | null = null;
  const updateEmbedToggleVisibility = () => {
    if (embedToggleSetting) {
      embedToggleSetting.settingEl.toggleClass("fs-hidden", !includeOriginalFile);
    }
  };

  new Setting(saveOptsFold.body)
    .setName("Download Original")
    .setDesc("Save the original handwriting or audio in your vault")
    .addToggle((tg) => tg.setValue(includeOriginalFile).onChange((v) => {
      includeOriginalFile = v;
      updateEmbedToggleVisibility();
    }));

  embedToggleSetting = new Setting(saveOptsFold.body)
    .setName("Embed Preview")
    .setDesc("Show an inline preview of the original file. When off, inserts a link instead.")
    .addToggle((tg) => tg.setValue(embedOriginal).onChange((v) => embedOriginal = v));
  updateEmbedToggleVisibility();

  // Enrichment Options (foldable)
  const aiFold = addFoldableSection(containerEl, "Enrichment Options");
  const routeInstrSetting = new Setting(aiFold.body)
    .setName("Instructions")
    .setDesc("Beyond transcription, Flowstate's AI can translate, summarize, add context, extract action items, and more.")
    .addTextArea((ta) => {
      ta.setValue(customInstructions).onChange((v) => customInstructions = v);
      ta.inputEl.rows = 4;
      ta.inputEl.addClass("fs-full-width");
      ta.setPlaceholder('e.g., "Translate to Spanish", "Add context and book suggestions", or "Turn circled words into hashtags"');
    });
  applyWideControl(routeInstrSetting);

  // Email (foldable) — only shown when editing an existing Project
  if (existing) {
    const emailFold = addFoldableSection(containerEl, "Email Options");
    // helper text
    const emailHelp = emailFold.body.createDiv({ cls: "fs-email-help" });
    emailHelp.appendText("Send your files to a unique address to auto-create notes in this Flow.");

    // Project Tag (editable)
    const slugSetting = new Setting(emailFold.body)
      .setName("Flow Tag")
      .setDesc("Lowercase letters, numbers, and dashes only.")
      .addText((t) => {
        t.setValue(slug)
          .onChange((v) => {
            slug = slugify(v);
            t.setValue(slug); // normalize input
            // live update email field
            const emailVal = computeEmail();
            const input = emailSetting.controlEl.querySelector("input");
            if (input) input.value = emailVal;
          });
        t.inputEl.addClass("fs-full-width");
      });
    applyWideControl(slugSetting);

    // Route Email (read-only with Copy button)
    const emailSetting = new Setting(emailFold.body)
      .setName("Flow Email")
      .setDesc(emailDomain ? `Send a file to this Flow. Supported file types: 1 PDF, 1 audio file, or multiple PNG/JPG files (will be combined).` : `Email domain not configured.`)
      .addText((t) => {
        t.setValue(computeEmail());
        t.setDisabled(true);
        t.inputEl.addClass("fs-full-width");
      });
    // Error message element for email copy
    const emailErrorEl = emailFold.body.createDiv({ cls: "fs-inline-error" });
    emailErrorEl.addClass("fs-hidden");
    emailSetting.addButton((b) =>
      b.setButtonText("Copy").onClick(async () => {
        // Clear previous error
        emailErrorEl.addClass("fs-hidden");
        emailErrorEl.textContent = "";
        try {
          // Save slug to backend first
          const supabase = getSupabase(plugin.settings);
          await updateRoute(supabase, existing.id, { slug });
          // Only copy if save succeeded
          await navigator.clipboard.writeText(computeEmail());
          new Notice("Email copied");
        } catch (e: unknown) {
          const errMsg = errorMessage(e);
          emailErrorEl.textContent = errMsg;
          emailErrorEl.removeClass("fs-hidden");
        }
      })
    );
    applyWideControl(emailSetting);

    // Fetch user handle asynchronously and update the email preview
    void (async () => {
      try {
        const supabase = getSupabase(plugin.settings);
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        const uid = data.user?.id;
        if (!uid) return;
        const { data: userRow, error: uErr } = await supabase
          .from("users")
          .select("handle")
          .eq("id", uid)
          .single();
        if (uErr) return;
        const nextHandle = userRow?.handle ? String(userRow.handle) : "";
        if (nextHandle) {
          userHandle = normalizeHandle(nextHandle);
          const input = emailSetting.controlEl.querySelector("input");
          if (input) input.value = computeEmail();
        }
      } catch {
        // leave empty; user may not be signed in yet
      }
    })();
  }

  // Actions
  const actions = containerEl.createDiv({ cls: "modal-button-container" });
  const spacer = actions.createDiv();
  const rightGroup = actions.createDiv();
  spacer.addClass("fs-spacer");
  rightGroup.addClass("fs-button-group");

  const saveBtn = new ButtonComponent(rightGroup).setButtonText("Save");
  new ButtonComponent(rightGroup).setButtonText("Cancel").onClick(() => onBack());


  saveBtn.onClick(async () => {
    saveBtn.setDisabled(true);
    saveBtn.setButtonText("Saving...");
    try {
      if (!name) throw new Error("Name is required");
      if (!destinationFolder) throw new Error("Destination is required");
      // Normalize path for cross-platform safety, then handle append target
      let normalizedDest = normalizePath(destinationFolder.trim());
      if (appendToExisting) {
        if (normalizedDest.endsWith("/")) {
          // If user provided a folder-like path, create a default file inside it
          normalizedDest = `${normalizedDest.replace(/\/+$/, "")}/Notes.md`;
        }
        if (!/\.md$/i.test(normalizedDest)) {
          normalizedDest = `${normalizedDest}.md`;
        }
      }

      let dest = app.vault.getAbstractFileByPath(normalizedDest);
      if (appendToExisting) {
        if (!(dest instanceof TFile)) {
          // Auto-create destination file if it does not exist (with robust retry)
          const parent = normalizedDest.split("/").slice(0, -1).join("/");
          if (parent) {
            try { await ensureFolder(app, parent); } catch { /* best-effort; retried below */ }
          }
          try {
            await atomicWrite(app, normalizedDest, "");
          } catch {
            // Retry once after ensuring folders again
            if (parent) {
              try { await ensureFolder(app, parent); } catch { /* best-effort; retried below */ }
            }
            await atomicWrite(app, normalizedDest, "");
          }
          dest = app.vault.getAbstractFileByPath(normalizedDest);
          if (!(dest instanceof TFile)) {
            throw new Error("Failed to create destination file. Please check the path and try again.");
          }
          // Persist normalization back to UI state
          destinationFolder = normalizedDest;
          const input = destinationSetting.controlEl.querySelector("input");
          if (input) input.value = destinationFolder;
        }
      } else {
        // Auto-create destination folder if it doesn't exist (with robust retry)
        if (!(dest instanceof TFolder)) {
          try {
            await ensureFolder(app, normalizedDest);
          } catch {
            // Retry once in case of race conditions or partial paths
            await ensureFolder(app, normalizedDest);
          }
          dest = app.vault.getAbstractFileByPath(normalizedDest);
        }
        if (!(dest instanceof TFolder)) throw new Error("Destination must be a folder path");
      }
      const supabase = getSupabase(plugin.settings);
      // Common project data for both create and update
      const projectData = {
        name,
        destination_location: destinationFolder,
        append_to_existing: appendToExisting,
        include_original_file: includeOriginalFile,
        destination_config: { ...destConfig, embed_original: embedOriginal },
        custom_instructions: customInstructions || null,
        use_ai_title: true, // Always use AI-generated titles
        ai_title_instructions: aiTitleInstructions || null,
      };

      const row = existing
        ? await updateRoute(supabase, existing.id, { ...projectData, slug })
        : await createProject(supabase, app, projectData);
      await onSaved(row);
      onBack();
    } catch (e: unknown) {
      console.error(e);
      new Notice(errorMessage(e));
    } finally {
      saveBtn.setDisabled(false);
      saveBtn.setButtonText("Save");
    }
  });
}
