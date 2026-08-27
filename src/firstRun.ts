import { normalizePath } from "obsidian";
import type FlowStatePlugin from "./main";
import type { Route } from "./types";
import { getSupabase, listObsidianRoutes, createProject, fetchUserHandle } from "./supabase";
import { DEFAULT_INGEST_EMAIL_DOMAIN } from "./config";
import { computeFlowEmail } from "./email";
import { ensureFolder, atomicWrite } from "./fs";
import { log, warn } from "./logger";

export const STARTER_FLOW_NAME = "Inbox";
export const STARTER_FOLDER = "Flowstate";
export const WELCOME_NOTE_NAME = "Welcome to Flowstate.md";

/**
 * The sample note delivered right after first sign-in, formatted the way a
 * real transcription lands so the user sees the end state before they've
 * captured anything.
 *
 * ⚠️ User-facing copy — follow the Flowstate voice guides before editing.
 */
export function welcomeNoteContent(flowEmail: string | null): string {
  const emailLine = flowEmail
    ? `- Email a photo of a page (or a voice memo) to your Inbox flow: \`${flowEmail}\`\n`
    : "";
  return `# Welcome to Flowstate

This note arrived the same way your handwriting will: dropped into your vault as clean, searchable text, filed exactly where you told it to go.

Here's the whole trick:

1. **Write on paper.** Or an e-ink tablet. Or think out loud into a voice memo.
2. **Capture it.** Snap it with the [Flowstate app](https://seekflowstate.com), or email it straight from your reMarkable, Boox, or Supernote.
3. **It lands here.** Transcribed, formatted, and filed by your flows. The words stay yours — Flowstate just does the typing.

We already made you a flow called **Inbox** that saves to this \`${STARTER_FOLDER}\` folder. Point it somewhere else, rename it, or add more flows any time in **Settings → Flowstate**.

## Try it now

${emailLine}- Or grab the [Flowstate app](https://seekflowstate.com) and snap a photo of anything handwritten within arm's reach.

A minute later, it shows up next to this note.

You have 50 free credits to play with — one page of handwriting or one minute of audio each. Go scribble something.

— Raj and Rob
`;
}

/**
 * One-time setup after a user's first sign-in from this vault:
 *  - if the account has no flows for this vault, create a starter "Inbox"
 *    flow saving into the "Flowstate" folder
 *  - write a sample welcome note into that folder and open it, so the first
 *    minute in the plugin ends with a real note in the vault
 *
 * Runs at most once per account (tracked in settings.starterSetupUsers) and
 * never for accounts that already have flows here. Best-effort: any failure
 * logs and returns false rather than interrupting sign-in.
 *
 * Returns true when the welcome note was delivered (i.e. this was a genuinely
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
      warn("firstRun: could not resolve flow email for welcome note", e);
    }

    const notePath = normalizePath(`${STARTER_FOLDER}/${WELCOME_NOTE_NAME}`);
    if (!(await plugin.app.vault.adapter.exists(notePath))) {
      await ensureFolder(plugin.app, STARTER_FOLDER);
      await atomicWrite(plugin.app, notePath, welcomeNoteContent(flowEmail));
      log("firstRun: welcome note written", { notePath });
    }
    await plugin.app.workspace.openLinkText(notePath, "", false);
    return true;
  } catch (e) {
    warn("firstRun: setup failed (continuing without it)", e);
    return false;
  }
}
