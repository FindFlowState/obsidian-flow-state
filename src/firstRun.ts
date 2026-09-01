import { normalizePath } from "obsidian";
import type FlowStatePlugin from "./main";
import type { Route } from "./types";
import { getSupabase, listObsidianRoutes, createProject, fetchUserHandle } from "./supabase";
import { DEFAULT_INGEST_EMAIL_DOMAIN } from "./config";
import { computeFlowEmail } from "./email";
import { WELCOME_VIEW_TYPE } from "./welcomeView";
import { SampleNoteModal } from "./sampleNoteModal";
import { WELCOME_PDF_BASE64 } from "./welcomePdf";
import { ensureFolder, atomicWrite, writeBinaryToAttachments } from "./fs";
import { log, warn } from "./logger";

export const STARTER_FLOW_NAME = "Inbox";
export const STARTER_FOLDER = "Flowstate";
export const SAMPLE_NOTE_TITLE = "Welcome to Flowstate";

/**
 * The transcription of the handwritten welcome letter (assets/
 * welcome-sample.pdf) — the two must say the same thing, so regenerate the
 * PDF if this changes. Formatted exactly like a real delivery: body text,
 * then the embedded original underneath.
 *
 * ⚠️ User-facing copy — follow the Flowstate voice guides before editing.
 */
export function sampleNoteContent(attachmentPath: string): string {
  return `If you can read this, everything worked — this page started as ink on paper.

Write on paper. Capture it with the Flowstate app, or email it from your e-ink tablet. A minute later it lands in your vault as clean, searchable text — filed wherever you told it to go.

The words stay yours. Flowstate just does the typing.

You have 50 free credits — one page of handwriting or one minute of audio each.

Go scribble something.

— Raj and Rob

![[${attachmentPath}]]
`;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Write the sample note + handwritten PDF into the vault (the user opted in
 * via SampleNoteModal — never call this without that consent). Returns the
 * note's path.
 */
export async function installSampleNote(plugin: FlowStatePlugin): Promise<string> {
  const app = plugin.app;
  await ensureFolder(app, STARTER_FOLDER);
  const pdfPath = await writeBinaryToAttachments(
    app,
    `${SAMPLE_NOTE_TITLE}.pdf`,
    base64ToBytes(WELCOME_PDF_BASE64),
    { baseFolder: STARTER_FOLDER }
  );
  const notePath = normalizePath(`${STARTER_FOLDER}/${SAMPLE_NOTE_TITLE}.md`);
  await atomicWrite(app, notePath, sampleNoteContent(pdfPath));
  log("firstRun: sample note installed", { notePath, pdfPath });
  return notePath;
}

/** Open the ephemeral welcome view (no vault writes). */
export async function openWelcomeView(plugin: FlowStatePlugin, flowEmail: string | null): Promise<void> {
  const leaf = plugin.app.workspace.getLeaf(true);
  await leaf.setViewState({ type: WELCOME_VIEW_TYPE, active: true, state: { flowEmail } });
}

/**
 * The welcome screen shown right after first sign-in, formatted the way a
 * real transcription lands so the user sees the end state before they've
 * captured anything. Rendered in an ephemeral view (see welcomeView.ts) —
 * it is never written to the vault.
 *
 * ⚠️ User-facing copy — follow the Flowstate voice guides before editing.
 */
export function welcomeNoteContent(flowEmail: string | null): string {
  const emailLine = flowEmail
    ? `- Email a photo of a page (or a voice memo) to your Inbox flow: \`${flowEmail}\`\n`
    : "";
  return `# Welcome to Flowstate

Your handwriting and voice memos will land in your vault looking a lot like this: clean, searchable text, filed exactly where you told it to go.

Here's the whole trick:

1. **Write on paper.** Or an e-ink tablet. Or think out loud into a voice memo.
2. **Capture it.** Snap it with the [Flowstate app](https://seekflowstate.com), or email it straight from your reMarkable, Boox, or Supernote.
3. **It lands in your vault.** Transcribed, formatted, and filed by your flows. The words stay yours — Flowstate just does the typing.

We already made you a flow called **Inbox** that saves to a \`${STARTER_FOLDER}\` folder. Point it somewhere else, rename it, or add more flows any time in **Settings → Flowstate**.

## Try it now

${emailLine}- Or grab the [Flowstate app](https://seekflowstate.com) and snap a photo of anything handwritten within arm's reach.

A minute later, it lands in your \`${STARTER_FOLDER}\` folder as a real note.

You have 50 free credits to play with — one page of handwriting or one minute of audio each. Go scribble something.

*This screen is just a preview — Flowstate won't write anything to your vault until you send it something.*

— Raj and Rob
`;
}

/**
 * Notice shown the very first time a synced note lands in the vault — the
 * payoff moment the welcome note promises, so it shouldn't happen silently.
 *
 * ⚠️ User-facing copy — follow the Flowstate voice guides before editing.
 */
export function firstDeliveryNoticeText(path: string): string {
  const name = (path.split("/").pop() ?? "note").replace(/\.md$/i, "");
  return `Your first note just landed: "${name}". Flowstate will keep delivering new notes automatically.`;
}

/** Notice for later deliveries (background syncs included). */
export function deliveryNoticeText(count: number): string {
  return `Flowstate: ${count} new note${count === 1 ? "" : "s"} in your vault`;
}

/**
 * One-time setup after a user's first sign-in from this vault:
 *  - if the account has no flows for this vault, create a starter "Inbox"
 *    flow saving into the "Flowstate" folder
 *  - offer the sample note (SampleNoteModal): opted in, the transcribed
 *    welcome letter + handwritten PDF are written to the vault; skipped, the
 *    welcome screen opens as an ephemeral view instead
 *
 * Nothing is written to the vault without the explicit opt-in above; the
 * first unprompted write happens when a real transcription is delivered.
 * Runs at most once per account (tracked in
 * settings.starterSetupUsers) and never for accounts that already have flows
 * here. Best-effort: any failure logs and returns false rather than
 * interrupting sign-in.
 *
 * Returns true when the welcome screen was opened (i.e. this was a genuinely
 * fresh account for this vault).
 */
export async function runFirstSignInSetup(plugin: FlowStatePlugin): Promise<boolean> {
  try {
    const supabase = getSupabase(plugin.settings);
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) throw userErr;
    const uid = userData.user?.id;
    if (!uid) return false;

    const done = plugin.settings.starterSetupUsers ?? [];
    if (done.includes(uid)) return false;

    const connectionId = await plugin.getMyConnectionId();
    if (!connectionId) return false;

    const existing = await listObsidianRoutes(supabase, connectionId);
    const isFresh = existing.length === 0;

    let route: Route | null = existing[0] ?? null;
    if (isFresh) {
      log("firstRun: creating starter flow", { uid, connectionId });
      route = await createProject(supabase, plugin.app, {
        name: STARTER_FLOW_NAME,
        destination_location: STARTER_FOLDER,
        include_original_file: true,
        append_to_existing: false,
        use_ai_title: true,
      });
      plugin.settings.routes = plugin.settings.routes || {};
      plugin.settings.routes[route.id] = route;
    }

    // Mark this account as set up either way, so we never auto-create a flow
    // the user later archived.
    plugin.settings.starterSetupUsers = [...done, uid];
    await plugin.saveSettings();

    if (!isFresh) return false;

    let flowEmail: string | null = null;
    try {
      const handle = await fetchUserHandle(supabase);
      flowEmail = computeFlowEmail(handle, route?.slug, DEFAULT_INGEST_EMAIL_DOMAIN);
    } catch (e) {
      warn("firstRun: could not resolve flow email for welcome screen", e);
    }

    // Offer the sample note. Opting in is the permission to write the two
    // sample files; skipping (or just closing) opens the ephemeral preview.
    new SampleNoteModal(plugin, async (addToVault) => {
      try {
        if (addToVault) {
          const notePath = await installSampleNote(plugin);
          await plugin.app.workspace.openLinkText(notePath, "", false);
        } else {
          await openWelcomeView(plugin, flowEmail);
        }
      } catch (e) {
        warn("firstRun: sample note step failed; falling back to preview", e);
        try { await openWelcomeView(plugin, flowEmail); } catch { /* give up quietly */ }
      }
    }).open();
    log("firstRun: sample note offer shown", { flowEmail: !!flowEmail });
    return true;
  } catch (e) {
    warn("firstRun: setup failed (continuing without it)", e);
    return false;
  }
}
