import { TFile, type App, normalizePath } from "obsidian";
import { errorMessage } from "./logger";
import sanitize from "sanitize-filename";

export async function ensureFolder(app: App, folderPath: string) {
  const parts = normalizePath(folderPath).split("/").filter(Boolean);
  let current = "";
  for (const p of parts) {
    current = current ? `${current}/${p}` : p;
    if (!(await app.vault.adapter.exists(current))) {
      await app.vault.createFolder(current);
    }
  }
}

export async function atomicWrite(app: App, path: string, content: string) {
  path = normalizePath(path);
  const exists = await app.vault.adapter.exists(path);
  if (exists) {
    const f = app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) {
      await app.vault.modify(f, content);
      return;
    }
  }
  // Ensure parent folders exist before creating a new file
  const parent = path.split("/").slice(0, -1).join("/");
  if (parent) {
    await ensureFolder(app, parent);
  }
  try {
    await app.vault.create(path, content);
  } catch (e: unknown) {
    // Handle race condition where file was created between exists check and create
    const msg = errorMessage(e);
    if (msg.includes("already exists") || msg.includes("File already exists")) {
      // File exists now, try to modify it instead
      const f = app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) {
        await app.vault.modify(f, content);
        return;
      }
    }
    throw e; // Re-throw if it's a different error
  }
}

export async function writeBinaryToAttachments(
  app: App,
  filename: string,
  data: ArrayBuffer | Uint8Array,
  options?: { baseFolder?: string; attachmentsSubdir?: string }
): Promise<string> {
  // Prefer user's default attachment folder configured in Obsidian, if available.
  // If it's a relative setting like "./attachments" (same folder as note), resolve
  // it against the provided baseFolder (destination note's folder).
  // Fallback order: user setting -> baseFolder -> "FlowState/_attachments".
  const userConfiguredFolder = (app.vault as { getConfig?: (key: string) => unknown }).getConfig?.("attachmentFolderPath") as string | undefined;

  let folder = "";
  const baseFolder = options?.baseFolder?.trim();
  const userFolder = userConfiguredFolder?.trim();

  if (userFolder && userFolder.length > 0) {
    if (userFolder === "." || userFolder === "./") {
      // "Same folder as current file" — resolves to the vault root when we have
      // no note folder to resolve against.
      folder = baseFolder || "";
    } else if (userFolder.startsWith("./")) {
      const rel = userFolder.slice(2);
      folder = baseFolder ? `${baseFolder}/${rel}` : rel;
    } else {
      // Absolute (vault-root) path
      folder = userFolder;
    }
  } else if (baseFolder && baseFolder.length > 0) {
    folder = baseFolder;
  } else {
    const base = "FlowState";
    const sub = options?.attachmentsSubdir ?? "_attachments";
    folder = `${base}/${sub}`;
  }

  // A "." or empty folder means the vault root — there is nothing to create, and
  // createFolder(".") would make a literal "." folder.
  folder = folder === "." ? "" : normalizePath(folder);
  if (folder) await ensureFolder(app, folder);

  // Compute a non-colliding path if needed
  const adapter = app.vault.adapter;
  const makePath = (name: string) => (folder ? normalizePath(`${folder}/${name}`) : normalizePath(name));

  let targetName = filename;
  let targetPath = makePath(targetName);
  if (await adapter.exists(targetPath)) {
    const extIdx = filename.lastIndexOf(".");
    const base = extIdx >= 0 ? filename.slice(0, extIdx) : filename;
    const ext = extIdx >= 0 ? filename.slice(extIdx) : "";
    let i = 1;
    while (await adapter.exists(makePath(`${base} ${i}${ext}`))) i++;
    targetName = `${base} ${i}${ext}`;
    targetPath = makePath(targetName);
  }

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);

  // Write through the Vault API, not vault.adapter. Adapter writes land on disk
  // without registering the file with the Vault, so Obsidian's file index — and
  // everything built on it, including Sync — can miss the attachment or hold a
  // stale record of it. Desktop has a filesystem watcher that usually papers
  // over this; iOS does not, which is how a note reaches another device with an
  // unreadable 0-page PDF next to it.
  try {
    await app.vault.createBinary(targetPath, ab);
  } catch (e: unknown) {
    // The file appeared between the exists() check above and the create.
    const msg = errorMessage(e);
    if (!msg.includes("already exists")) throw e;
    const f = app.vault.getAbstractFileByPath(targetPath);
    if (!(f instanceof TFile)) throw e;
    await app.vault.modifyBinary(f, ab);
  }
  return targetPath;
}

// Utilities moved from templates.ts
export function sanitizePath(p: string): string {
  return sanitize(p).trim();
}

export function buildSafeNoteFilename(baseTitle: string, maxBaseLength = 120): string {
  const sanitized = sanitize(baseTitle || "Untitled").trim();
  const base = sanitized.length > 0 ? sanitized : "Untitled";
  const truncated = base.length > maxBaseLength ? base.slice(0, maxBaseLength).trim() : base;
  return truncated.endsWith(".md") ? truncated : `${truncated}.md`;
}