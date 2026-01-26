import { TFile, type App, normalizePath } from "obsidian";
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
  await app.vault.create(path, content);
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
  // Fallback order: user setting -> baseFolder -> "Flow State/_attachments".
  const userConfiguredFolder = (app.vault as any).getConfig?.("attachmentFolderPath") as string | undefined;

  let folder = "";
  const baseFolder = options?.baseFolder?.trim();
  const userFolder = userConfiguredFolder?.trim();

  if (userFolder && userFolder.length > 0) {
    if (userFolder === "." || userFolder === "./") {
      folder = baseFolder || ".";
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
    const base = "Flow State";
    const sub = options?.attachmentsSubdir ?? "_attachments";
    folder = `${base}/${sub}`;
  }

  folder = normalizePath(folder);
  await ensureFolder(app, folder);

  // Compute a non-colliding path if needed
  const adapter = app.vault.adapter;
  const makePath = (name: string) => normalizePath(`${folder}/${name}`);

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
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await adapter.writeBinary(targetPath, ab as ArrayBuffer);
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