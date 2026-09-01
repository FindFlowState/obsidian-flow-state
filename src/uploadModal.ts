import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import type FlowStatePlugin from "./main";
import type { Route } from "./types";
import { getSupabase, listObsidianRoutes, createProject, fetchUserCredits } from "./supabase";
import { errorMessage } from "./logger";

// Mirrors the web app's upload surface (apps/web, Home.tsx + imageToPdf.ts):
// same accepted types, same mixing rules, same start-flow → signed upload →
// begin-processing pipeline, and the same image→PDF conversion (the uploads
// bucket only accepts PDF and audio). One divergence: HEIC/HEIF is rejected
// here — the web app decodes it with a ~1.4MB wasm library; in the plugin we
// point those users at the mobile app instead.
const ACCEPT = "image/*,application/pdf,audio/*";
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100 MB, same as web
const NEW_FLOW_VALUE = "__new__";

const HEIC_RE = /\.(heic|heif)$/i;

type PickedFile = {
  file: File;
  /** Estimated credits (pages / minutes); null while still estimating. */
  credits: number | null;
};

export function openUploadModal(app: App, plugin: FlowStatePlugin): void {
  new UploadModal(app, plugin).open();
}

function isImage(f: File): boolean { return (f.type || "").startsWith("image/"); }
function isAudio(f: File): boolean { return (f.type || "").startsWith("audio/"); }
function isPdf(f: File): boolean { return f.type === "application/pdf" || /\.pdf$/i.test(f.name); }

/** Same mixing rules as the web app's validateFileCollection. */
function validateCollection(files: File[]): string | null {
  const pdfs = files.filter(isPdf);
  const audio = files.filter(isAudio);
  const images = files.filter(isImage);
  if (audio.length > 0 && (images.length > 0 || pdfs.length > 0)) {
    return "Can't mix audio files with images or PDFs.";
  }
  if (pdfs.length > 0 && images.length > 0) {
    return "Can't mix PDF files with images. Upload either a PDF or images.";
  }
  return null;
}

/** Rough page count for a PDF (regex over the raw bytes; good enough for an estimate). */
async function estimatePdfPages(file: File): Promise<number> {
  try {
    const text = new TextDecoder("latin1").decode(await file.arrayBuffer());
    const matches = text.match(/\/Type\s*\/Page[^s]/g);
    return Math.max(1, matches?.length ?? 1);
  } catch {
    return 1;
  }
}

/** Audio length in whole minutes (rounded up), via an off-screen media element. */
function estimateAudioMinutes(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (minutes: number) => { URL.revokeObjectURL(url); resolve(minutes); };
    audio.addEventListener("loadedmetadata", () => {
      const secs = Number.isFinite(audio.duration) ? audio.duration : 60;
      done(Math.max(1, Math.ceil(secs / 60)));
    });
    audio.addEventListener("error", () => done(1));
    audio.src = url;
  });
}

async function estimateCredits(file: File): Promise<number> {
  if (isAudio(file)) return estimateAudioMinutes(file);
  if (isPdf(file)) return estimatePdfPages(file);
  return 1; // one image = one page
}

/** Convert an image File to a single-page PDF (same convention as every other capture path). */
async function imageToPdfFile(file: File): Promise<File> {
  const { jsPDF } = await import("jspdf");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Could not decode image (${file.name}).`));
      el.src = url;
    });
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) throw new Error("Image has no dimensions.");
    const canvas = activeDocument.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 36;
    const boxW = pageW - margin * 2;
    const boxH = pageH - margin * 2;
    const aspect = width / height;
    let drawW = boxW;
    let drawH = drawW / aspect;
    if (drawH > boxH) { drawH = boxH; drawW = drawH * aspect; }
    doc.addImage(dataUrl, "JPEG", (pageW - drawW) / 2, (pageH - drawH) / 2, drawW, drawH);
    const blob = doc.output("blob");
    const base = file.name.replace(/\.[^/.]+$/, "");
    return new File([blob], `${base}.pdf`, { type: "application/pdf" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Upload files from inside Obsidian: pick files, pick (or create) a flow, add
 * optional per-upload instructions, see the estimated credit cost, go.
 *
 * ⚠️ User-facing copy — follow the Flowstate voice guides before editing.
 */
class UploadModal extends Modal {
  private picked: PickedFile[] = [];
  private routes: Route[] = [];
  private selectedRouteId: string | null = null;
  private newFlowName = "";
  private newFlowDest = "";
  private instructions = "";
  private balance: number | null = null;
  private unlimited = false;
  private uploading = false;
  private fileInput: HTMLInputElement | null = null;

  constructor(app: App, private plugin: FlowStatePlugin) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("fs-upload-modal");
    // Hidden native file picker
    this.fileInput = this.contentEl.createEl("input", { type: "file", cls: "fs-hidden" });
    this.fileInput.accept = ACCEPT;
    this.fileInput.multiple = true;
    this.fileInput.addEventListener("change", () => {
      if (this.fileInput?.files) this.addFiles(Array.from(this.fileInput.files));
      if (this.fileInput) this.fileInput.value = "";
    });
    this.render();

    // Load flows + credit balance in the background
    void (async () => {
      try {
        const supabase = getSupabase(this.plugin.settings);
        const connectionId = await this.plugin.getMyConnectionId();
        if (connectionId) {
          this.routes = await listObsidianRoutes(supabase, connectionId);
          if (!this.selectedRouteId && this.routes.length > 0) {
            this.selectedRouteId = this.routes[0].id;
          } else if (this.routes.length === 0) {
            this.selectedRouteId = NEW_FLOW_VALUE;
          }
        }
        const credits = await fetchUserCredits(supabase);
        if (credits) {
          this.unlimited = credits.subscription_plan === "unlimited";
          this.balance = (credits.subscription_credits ?? 0) + (credits.purchased_credits ?? 0);
        }
      } catch (e) {
        console.error("upload modal: failed to load flows/credits", e);
      }
      this.render();
    })();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private addFiles(files: File[]): void {
    for (const f of files) {
      if (HEIC_RE.test(f.name) || /hei[cf]/.test(f.type)) {
        new Notice(`${f.name}: HEIC photos aren't supported here yet — use the Flowstate app, or convert to JPG first.`);
        continue;
      }
      if (f.size > MAX_UPLOAD_SIZE) {
        new Notice(`${f.name} is too large. Maximum size is ${MAX_UPLOAD_SIZE / 1024 / 1024}MB.`);
        continue;
      }
      if (this.picked.some((p) => p.file.name === f.name && p.file.size === f.size)) continue;
      const entry: PickedFile = { file: f, credits: null };
      this.picked.push(entry);
      void estimateCredits(f).then((n) => {
        entry.credits = n;
        this.render();
      });
    }
    this.render();
  }

  private totalEstimate(): number | null {
    if (this.picked.some((p) => p.credits === null)) return null;
    return this.picked.reduce((sum, p) => sum + (p.credits ?? 0), 0);
  }

  private render(): void {
    const { titleEl, contentEl } = this;
    titleEl.setText("Upload to Flowstate");
    // Keep the hidden input; rebuild everything after it
    for (const child of Array.from(contentEl.children)) {
      if (child !== this.fileInput) child.remove();
    }

    contentEl.createEl("p", {
      text: "Send handwriting or audio straight from this computer. Images, PDFs, and audio files — one credit per page or minute.",
      cls: "fs-ob-tagline",
    });

    // --- Files ---
    const filesSetting = new Setting(contentEl)
      .setName("Files")
      .setDesc(this.picked.length === 0 ? "Images, PDFs, or audio. Pick several to batch." : "");
    filesSetting.addButton((b) =>
      b.setButtonText(this.picked.length === 0 ? "Choose files" : "Add more").onClick(() => {
        this.fileInput?.click();
      })
    );

    if (this.picked.length > 0) {
      const list = contentEl.createDiv({ cls: "fs-upload-list" });
      for (const p of this.picked) {
        const row = list.createDiv({ cls: "fs-upload-row" });
        const icon = isAudio(p.file) ? "🎙" : isPdf(p.file) ? "📄" : "🖼";
        row.createSpan({ text: icon, cls: "fs-upload-icon" });
        const info = row.createDiv({ cls: "fs-upload-info" });
        info.createDiv({ text: p.file.name, cls: "fs-upload-name" });
        const sizeMb = (p.file.size / 1024 / 1024).toFixed(1);
        const creditsTxt = p.credits === null
          ? "estimating…"
          : `~${p.credits} credit${p.credits === 1 ? "" : "s"}`;
        info.createDiv({ text: `${sizeMb} MB · ${creditsTxt}`, cls: "fs-upload-meta" });
        const remove = row.createEl("a", { text: "Remove", cls: "fs-muted-link fs-upload-remove" });
        remove.addEventListener("click", (e) => {
          e.preventDefault();
          this.picked = this.picked.filter((x) => x !== p);
          this.render();
        });
      }
      const mixError = validateCollection(this.picked.map((p) => p.file));
      if (mixError) contentEl.createDiv({ text: mixError, cls: "fs-inline-error" });
    }

    // --- Flow choice ---
    const flowSetting = new Setting(contentEl)
      .setName("Flow")
      .setDesc("Where the transcription gets filed.");
    flowSetting.addDropdown((dd) => {
      for (const r of this.routes) dd.addOption(r.id, r.name);
      dd.addOption(NEW_FLOW_VALUE, "➕ New flow…");
      dd.setValue(this.selectedRouteId ?? (this.routes[0]?.id ?? NEW_FLOW_VALUE));
      dd.onChange((v) => {
        this.selectedRouteId = v;
        this.render();
      });
    });

    if (this.selectedRouteId === NEW_FLOW_VALUE) {
      const nameSetting = new Setting(contentEl).setName("New flow name");
      nameSetting.settingEl.addClass("fs-upload-newflow");
      nameSetting.addText((t) => {
        t.setPlaceholder("Journal");
        t.setValue(this.newFlowName);
        t.onChange((v) => {
          this.newFlowName = v;
          const destInput = destSetting.controlEl.querySelector("input");
          if (destInput && !this.newFlowDest) destInput.placeholder = v ? `Flowstate/${v}` : "Flowstate";
        });
      });
      const destSetting = new Setting(contentEl)
        .setName("Destination folder")
        .setDesc("Created if it doesn't exist. Change it later in the flow's settings.");
      destSetting.settingEl.addClass("fs-upload-newflow");
      destSetting.addText((t) => {
        t.setPlaceholder("Flowstate");
        t.setValue(this.newFlowDest);
        t.onChange((v) => { this.newFlowDest = v; });
      });
    }

    // --- Instructions ---
    const instrSetting = new Setting(contentEl)
      .setName("File instructions")
      .setDesc("Optional. Applies to this upload only, on top of the flow's own instructions.");
    instrSetting.addTextArea((ta) => {
      ta.setValue(this.instructions);
      ta.setPlaceholder('e.g., "Summarize in bullet points"');
      ta.inputEl.rows = 2;
      ta.inputEl.addClass("fs-full-width");
      ta.onChange((v) => { this.instructions = v; });
    });
    instrSetting.settingEl.addClass("fs-upload-instructions");

    // --- Credits summary + actions ---
    const footer = contentEl.createDiv({ cls: "fs-upload-footer" });
    const summary = footer.createDiv({ cls: "fs-upload-summary" });
    if (this.picked.length > 0) {
      const est = this.totalEstimate();
      const estTxt = est === null ? "…" : String(est);
      const balanceTxt = this.unlimited
        ? "you have Unlimited"
        : this.balance === null ? "" : `you have ${this.balance}`;
      summary.createSpan({
        text: `Estimated credits: ${estTxt}${balanceTxt ? ` · ${balanceTxt}` : ""}`,
        cls: "fs-upload-estimate",
      });
      if (!this.unlimited && est !== null && this.balance !== null && est > this.balance) {
        summary.createDiv({ text: "That's more than your balance — the upload may not finish. Top up in Credits below.", cls: "fs-inline-error" });
      }
      summary.createDiv({
        text: "Estimates. The final count is pages and audio minutes, tallied after processing.",
        cls: "fs-upload-fineprint",
      });
    }
    const btnRow = footer.createDiv({ cls: "fs-sample-buttons" });
    const cancel = new ButtonComponent(btnRow);
    cancel.setButtonText("Cancel").onClick(() => this.close());
    const upload = new ButtonComponent(btnRow);
    const n = this.picked.length;
    upload.setCta().setButtonText(this.uploading ? "Uploading…" : `Upload${n > 0 ? ` ${n} file${n === 1 ? "" : "s"}` : ""}`);
    upload.setDisabled(this.uploading || n === 0 || !!validateCollection(this.picked.map((p) => p.file)));
    upload.onClick(() => void this.upload(upload));
  }

  /** Resolve the target route id, creating the new flow first if asked to. */
  private async resolveRouteId(): Promise<string> {
    if (this.selectedRouteId && this.selectedRouteId !== NEW_FLOW_VALUE) return this.selectedRouteId;
    const name = this.newFlowName.trim();
    if (!name) throw new Error("Give your new flow a name first.");
    const dest = this.newFlowDest.trim() || `Flowstate/${name}`;
    const supabase = getSupabase(this.plugin.settings);
    const route = await createProject(supabase, this.app, {
      name,
      destination_location: dest,
      include_original_file: true,
      append_to_existing: false,
      use_ai_title: true,
    });
    this.plugin.settings.routes = this.plugin.settings.routes || {};
    this.plugin.settings.routes[route.id] = route;
    await this.plugin.saveSettings();
    this.selectedRouteId = route.id;
    return route.id;
  }

  private async upload(button: ButtonComponent): Promise<void> {
    if (this.uploading || this.picked.length === 0) return;
    this.uploading = true;
    const supabase = getSupabase(this.plugin.settings);
    let ok = 0;
    let failed = 0;
    try {
      const routeId = await this.resolveRouteId();
      const instructions = this.instructions.trim();

      for (let i = 0; i < this.picked.length; i++) {
        button.setButtonText(`Uploading ${i + 1}/${this.picked.length}…`);
        button.setDisabled(true);
        const original = this.picked[i].file;
        let jobId: string | null = null;
        try {
          // The uploads bucket only accepts PDF + audio; convert images first.
          const file = isImage(original) ? await imageToPdfFile(original) : original;

          const startRes = (await supabase.functions.invoke("start-flow", {
            body: {
              route_id: routeId,
              original_filename: file.name,
              source: "obsidian",
              ...(instructions ? { custom_instructions: instructions } : {}),
            },
          })) as { data: unknown; error: { message?: string } | null };
          if (startRes.error) throw new Error(startRes.error.message || "Failed to start flow");
          const { job_id, upload_token, storage } = (startRes.data ?? {}) as {
            job_id?: string;
            upload_token?: string;
            storage?: { bucket?: string; object_path?: string };
          };
          jobId = job_id ?? null;
          if (!upload_token || !storage?.bucket || !storage?.object_path) {
            throw new Error("Server did not return upload_token or storage metadata");
          }

          const contentType = (file.type || "").split(";")[0].trim() || "application/octet-stream";
          const { error: upErr } = await supabase.storage
            .from(storage.bucket)
            .uploadToSignedUrl(storage.object_path, upload_token, file, { contentType, upsert: false });
          if (upErr) throw new Error(`Upload failed: ${upErr.message || "unknown error"}`);

          const beginRes = (await supabase.functions.invoke("begin-processing", {
            body: { job_id },
          })) as { error: { message?: string } | null };
          if (beginRes.error) throw new Error(beginRes.error.message || "Failed to begin processing");
          ok++;
        } catch (e) {
          failed++;
          console.error("upload failed", original.name, e);
          new Notice(`${original.name}: ${errorMessage(e)}`);
          // Clean up the pending job so it doesn't linger (same as web)
          if (jobId) {
            try {
              await supabase.from("jobs").delete().eq("id", jobId).eq("status", "pending");
            } catch { /* best-effort */ }
          }
        }
      }
    } catch (e) {
      new Notice(errorMessage(e));
      this.uploading = false;
      this.render();
      return;
    }

    this.uploading = false;
    if (ok > 0) {
      new Notice(`${ok} file${ok === 1 ? "" : "s"} sent to Flowstate. The notes land in your vault in a minute or two.`);
      // Check for results a couple of times ahead of the regular poller.
      window.setTimeout(() => void this.plugin.syncNow(true), 45_000);
      window.setTimeout(() => void this.plugin.syncNow(true), 120_000);
      this.close();
    } else if (failed > 0) {
      this.render(); // keep the modal open so they can retry
    }
  }
}
