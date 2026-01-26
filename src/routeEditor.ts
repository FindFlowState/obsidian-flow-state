import { App, ButtonComponent, Notice, Setting, AbstractInputSuggest, TFolder, TFile } from "obsidian";
import type FlowStatePlugin from "./main";
import type { Route } from "@flowstate/supabase-types";
import { getSupabase, createProject, updateRoute, deleteRoute } from "./supabase";
import { DEFAULT_INGEST_EMAIL_DOMAIN } from "./config";
import { ensureFolder, atomicWrite } from "./fs";

// Inline folder typeahead using Obsidian's AbstractInputSuggest
class FolderInputSuggest extends AbstractInputSuggest<TFolder> {
  private onChoose: (f: TFolder) => void;
  constructor(app: App, public inputEl: HTMLInputElement, onChoose: (f: TFolder) => void) {
    super(app, inputEl);
    this.onChoose = onChoose;
  }
  getSuggestions(query: string): TFolder[] {
    const q = query.toLowerCase();
    const all = this.app.vault.getAllLoadedFiles() as any[];
    const items = (all.filter((f) => f instanceof TFolder) as TFolder[])
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
    setTimeout(() => this.inputEl.focus(), 0);
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
    const all = this.app.vault.getAllLoadedFiles() as any[];
    const items = (all.filter((f) => f instanceof TFile) as TFile[])
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
    setTimeout(() => this.inputEl.focus(), 0);
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
    (s.controlEl as HTMLElement).style.flexGrow = "1";
    (s.controlEl as HTMLElement).style.minWidth = "450px"; // wider left side
    (s.controlEl as HTMLElement).style.maxWidth = "100%";
  };

  // Local state
  let name = existing?.name ?? "";
  let destinationFolder = existing?.destination_location ?? "";
  let includeOriginalFile = existing?.include_original_file ?? true;
  let appendToExisting = existing?.append_to_existing ?? false;
  let customInstructions = existing?.custom_instructions ?? "";
  let aiTitleInstructions = existing?.ai_title_instructions ?? "";
  let slug = (existing as any)?.slug ?? "";
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
  headerRow.style.display = "flex";
  headerRow.style.alignItems = "center";
  headerRow.style.gap = "8px";
  const backBtnEl = headerRow.createEl("button", { text: "←" });
  backBtnEl.addEventListener("click", () => onBack());
  const keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") { onBack(); } };
  window.addEventListener("keydown", keyHandler, { once: true });
  const title = headerRow.createEl("h2", { text: existing ? "Edit Project" : "Add Project" });
  title.style.fontSize = "1.6em";

  // Name
  const nameSetting = new Setting(containerEl)
    .setName("Name")
    .addText((t) => {
      t.setPlaceholder("Journal Entries").setValue(name).onChange((v) => name = v);
      t.inputEl.style.width = "100%";
    });
  applyWideControl(nameSetting);

  // Content type selection removed; processing determines type from MIME

  // Append toggle
  let destinationSetting: Setting;
  let updateTitleInstrLabel: () => void;
  new Setting(containerEl)
    .setName("Append to existing")
    .setDesc("If on, destination should be a file. A heading will be added for each upload.")
    .addToggle((tg) => tg.setValue(appendToExisting).onChange((v) => {
      appendToExisting = v;
      if (destinationSetting) destinationSetting.setName(appendToExisting ? "Destination File" : "Destination Folder");
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
  destinationSetting = new Setting(containerEl).setName(appendToExisting ? "Destination File" : "Destination Folder");
  let destinationInputEl: HTMLInputElement;
  let destinationSuggest: AbstractInputSuggest<any> | null = null;
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
          setTimeout(() => {
            rebuildDestinationControl();
          }, 0);
        })
      : new FolderInputSuggest(app, destinationInputEl, (folder) => {
          destinationFolder = folder.path;
          destinationInputEl.value = destinationFolder;
          lastFolderPathSelected = destinationFolder;
          setTimeout(() => {
            rebuildDestinationControl();
          }, 0);
        });
  };
  const rebuildDestinationControl = () => {
    // Remove existing input and build a fresh one so AbstractInputSuggest attaches cleanly
    destinationSetting.controlEl.empty();
    const input = destinationSetting.controlEl.createEl("input", { type: "text" });
    input.addClass("fs-destination-input");
    input.style.width = "100%";
    input.value = destinationFolder;
    input.placeholder = appendToExisting ? "Type to search files…" : "Type to search folders…";
    input.addEventListener("input", (e) => {
      destinationFolder = (e.target as HTMLInputElement).value;
      // Opportunistically remember typed value per mode
      if (appendToExisting) lastFilePathSelected = destinationFolder;
      else lastFolderPathSelected = destinationFolder;
    });
    destinationInputEl = input as HTMLInputElement;
    setupDestinationSuggest();
  };
  // Initial build
  rebuildDestinationControl();
  applyWideControl(destinationSetting);

  // Foldable sections helper (default closed) with arrow indicator and extra spacing
  const addFoldableSection = (parent: HTMLElement, heading: string) => {
    const section = parent.createDiv({ cls: "fs-foldable-section" });
    (section as HTMLDivElement).style.marginTop = "18px"; // extra vertical spacing
    const header = section.createEl("div", { cls: "fs-section-header" });
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "6px";
    header.style.fontSize = "1.2em";
    header.style.fontWeight = "600";
    header.style.cursor = "pointer";
    const arrow = header.createEl("span", { text: "▸" });
    const label = header.createEl("span", { text: heading });
    const body = section.createDiv({ cls: "fs-section-body" });
    body.style.marginTop = "10px";
    let open = false;
    const update = () => {
      body.style.display = open ? "" : "none";
      arrow.textContent = open ? "▾" : "▸";
    };
    header.addEventListener("click", () => { open = !open; update(); });
    update();
    return { section, header, body, setOpen: (v: boolean) => { open = v; update(); } };
  };

  // Save Options (foldable)
  const saveOptsFold = addFoldableSection(containerEl, "Save Options");

  new Setting(saveOptsFold.body)
    .setName("Download Original")
    .setDesc("Save the original handwriting or audio in your vault")
    .addToggle((tg) => tg.setValue(includeOriginalFile).onChange((v) => includeOriginalFile = v));

  // Title Instructions (dynamic name/desc based on append mode)
  const titleInstrSetting = new Setting(saveOptsFold.body)
    .addTextArea((ta) => {
      ta.setValue(aiTitleInstructions).onChange((v) => aiTitleInstructions = v);
      ta.inputEl.rows = 2;
      ta.inputEl.style.width = "100%";
      ta.inputEl.maxLength = 100;
      ta.setPlaceholder("e.g., Keep it short and descriptive");
    });
  updateTitleInstrLabel = () => {
    titleInstrSetting.setName(appendToExisting ? "Note Heading Instructions" : "File Name Instructions");
    titleInstrSetting.setDesc(
      appendToExisting
        ? "Note headings are automatically generated. Provide optional instructions for how you want them named."
        : "File names are automatically generated. Provide optional instructions for how you want them named."
    );
  };
  updateTitleInstrLabel();
  applyWideControl(titleInstrSetting);

  // Enrichment Options (foldable)
  const aiFold = addFoldableSection(containerEl, "Enrichment Options");
  const routeInstrSetting = new Setting(aiFold.body)
    .setName("Instructions")
    .setDesc("Beyond transcription, FlowState's AI can translate, summarize, add context, extract action items, and more.")
    .addTextArea((ta) => {
      ta.setValue(customInstructions).onChange((v) => customInstructions = v);
      ta.inputEl.rows = 4;
      ta.inputEl.style.width = "100%";
      ta.setPlaceholder('e.g., "Translate to Spanish", "Add context and book suggestions", or "Turn circled words into hashtags"');
    });
  applyWideControl(routeInstrSetting);

  // Email (foldable) — only shown when editing an existing Project
  if (existing) {
    const emailFold = addFoldableSection(containerEl, "Email Options");
    // helper text
    const emailHelp = emailFold.body.createDiv();
    emailHelp.style.fontSize = "0.9em";
    emailHelp.style.color = "var(--text-muted)";
    emailHelp.appendText("Send your files to a unique address to auto-create notes in this Project.");

    // Project Tag (editable)
    const slugSetting = new Setting(emailFold.body)
      .setName("Project Tag")
      .setDesc("Lowercase letters, numbers, and dashes only.")
      .addText((t) => {
        t.setValue(slug)
          .onChange((v) => {
            slug = slugify(v);
            t.setValue(slug); // normalize input
            // live update email field
            const emailVal = computeEmail();
            const input = emailSetting.controlEl.querySelector("input") as HTMLInputElement | null;
            if (input) input.value = emailVal;
          });
        t.inputEl.style.width = "100%";
      });
    applyWideControl(slugSetting);

    // Route Email (read-only with Copy button)
    const emailSetting = new Setting(emailFold.body)
      .setName("Project Email")
      .setDesc(emailDomain ? `Send a file to this project. Supported file types: 1 PDF, 1 audio file, or multiple PNG/JPG files (will be combined).` : `Email domain not configured.`)
      .addText((t) => {
        t.setValue(computeEmail());
        t.setDisabled(true);
        t.inputEl.style.width = "100%";
      });
    // Error message element for email copy
    const emailErrorEl = emailFold.body.createDiv();
    emailErrorEl.style.fontSize = "0.85em";
    emailErrorEl.style.color = "var(--text-error)";
    emailErrorEl.style.marginTop = "4px";
    emailErrorEl.style.display = "none";
    emailSetting.addButton((b) =>
      b.setButtonText("Copy").onClick(async () => {
        // Clear previous error
        emailErrorEl.style.display = "none";
        emailErrorEl.textContent = "";
        try {
          // Save slug to backend first
          const supabase = getSupabase(plugin.settings);
          await updateRoute(supabase, existing.id, { slug });
          // Only copy if save succeeded
          await navigator.clipboard.writeText(computeEmail());
          new Notice("Email copied");
        } catch (e: any) {
          const errMsg = e?.message ?? String(e);
          emailErrorEl.textContent = errMsg;
          emailErrorEl.style.display = "block";
        }
      })
    );
    applyWideControl(emailSetting);

    // Fetch user handle asynchronously and update the email preview
    (async () => {
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
        const nextHandle = (userRow as any)?.handle ? String((userRow as any).handle) : "";
        if (nextHandle) {
          userHandle = normalizeHandle(nextHandle);
          const input = emailSetting.controlEl.querySelector("input") as HTMLInputElement | null;
          if (input) input.value = computeEmail();
        }
      } catch (e) {
        // leave empty; user may not be signed in yet
      }
    })();
  }

  // Actions
  const actions = containerEl.createDiv({ cls: "modal-button-container" });
  const spacer = actions.createDiv();
  const rightGroup = actions.createDiv();
  spacer.style.flex = "1"; // push actions to the right
  rightGroup.style.display = "flex";
  rightGroup.style.gap = "8px";

  const saveBtn = new ButtonComponent(rightGroup).setButtonText("Save");
  new ButtonComponent(rightGroup).setButtonText("Cancel").onClick(() => onBack());


  saveBtn.onClick(async () => {
    try {
      if (!name) throw new Error("Name is required");
      if (!destinationFolder) throw new Error("Destination is required");
      // Normalize append target to a file with .md when appending
      let normalizedDest = destinationFolder.trim();
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
            try { await ensureFolder(app, parent); } catch {}
          }
          try {
            await atomicWrite(app, normalizedDest, "");
          } catch (e) {
            // Retry once after ensuring folders again
            if (parent) {
              try { await ensureFolder(app, parent); } catch {}
            }
            await atomicWrite(app, normalizedDest, "");
          }
          dest = app.vault.getAbstractFileByPath(normalizedDest);
          if (!(dest instanceof TFile)) {
            throw new Error("Failed to create destination file. Please check the path and try again.");
          }
          // Persist normalization back to UI state
          destinationFolder = normalizedDest;
          const input = destinationSetting.controlEl.querySelector("input") as HTMLInputElement | null;
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
      if (existing) {
        const row = await updateRoute(supabase, existing.id, {
          name,
          slug,
          destination_location: destinationFolder,
          append_to_existing: appendToExisting,
          include_original_file: includeOriginalFile,
          custom_instructions: customInstructions || null,
          use_ai_title: true, // Always use AI-generated titles
          ai_title_instructions: aiTitleInstructions || null,
        });
        await onSaved(row);
      } else {
        const row = await createProject(supabase, app, {
          name,
          // Do not pass slug on create; backend will generate
          destination_location: destinationFolder,
          append_to_existing: appendToExisting,
          include_original_file: includeOriginalFile,
          custom_instructions: customInstructions || null,
          use_ai_title: true, // Always use AI-generated titles
          ai_title_instructions: aiTitleInstructions || null,
        });
        await onSaved(row);
      }
      onBack();
    } catch (e: any) {
      console.error(e);
      new Notice(e?.message ?? String(e));
    }
  });
}
