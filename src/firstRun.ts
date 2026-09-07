import { normalizePath, type App } from "obsidian";
import type FlowStatePlugin from "./main";
import type { Route } from "./types";
import { getSupabase, listObsidianRoutes, createProject, fetchUserHandle } from "./supabase";
import { DEFAULT_INGEST_EMAIL_DOMAIN } from "./config";
import { computeFlowEmail } from "./email";
import { WELCOME_VIEW_TYPE } from "./welcomeView";
import { SAMPLE_PDF_BASE64 } from "./samplePdf";
import { atomicWrite, writeBinaryToAttachments } from "./fs";
import { log, warn } from "./logger";

export const STARTER_FLOW_NAME = "Inbox";
/**
 * Folder the starter "Inbox" flow delivers into. Deliveries are ongoing, so
 * they get their own folder rather than the vault root. Referenced by the
 * welcome copy below too, so the two can't drift apart.
 *
 * (The one-off sample note is deliberately different — it goes to the vault
 * root, where the user will actually see it.)
 */
export const STARTER_FOLDER = "Flowstate";
export const SAMPLE_NOTE_TITLE = "Where Lorem Ipsum comes from";

/**
 * Href of the "add a sample note" action in the welcome screen. Not a real URL —
 * WelcomeView finds this link after rendering and swaps its paragraph for a
 * proper CTA card, falling back to a plain clickable link if that ever fails.
 */
export const SAMPLE_ACTION_HREF = "flowstate:add-sample";

/**
 * Copy for the sample-note CTA card (built as DOM in welcomeView.ts, so it
 * can't live in the markdown above).
 *
 * ⚠️ User-facing copy — follow the Flowstate voice guides before editing.
 */
export const SAMPLE_CTA = {
  body: "We wrote you a real handwritten page, so you can see what it looks like in your Vault.",
  button: "See a sample note",
  doneBody: "Added a sample note to your vault.",
  doneButton: "Open it",
} as const;

/** Href of the "upload a file" link in the welcome screen — opens the plugin's upload modal. */
export const UPLOAD_ACTION_HREF = "flowstate:upload";

/**
 * Href of the bottom CTA in the welcome screen (after Credits, before the
 * sign-off). Like the sample link, WelcomeView swaps its paragraph for a CTA
 * card: sign-in when signed out, upload when signed in.
 */
export const BOTTOM_CTA_HREF = "flowstate:bottom-cta";

/**
 * Copy for the welcome screen's bottom CTA card (built as DOM in
 * welcomeView.ts). Signed-out readers get the door in; signed-in readers get
 * the first real capture.
 *
 * ⚠️ User-facing copy — follow the Flowstate voice guides before editing.
 */
export const GET_STARTED_CTA = {
  body: "Sign in or create an account — new accounts start with 25 free credits.",
  button: "Get started",
} as const;

export const UPLOAD_CTA = {
  body: "Grab a handwritten page or a voice memo and watch it land in your Vault.",
  button: "Upload a file",
} as const;

/** Href that opens this plugin's settings tab, rather than telling the user where to click. */
export const SETTINGS_ACTION_HREF = "flowstate:settings";

/** Support address, offered as click-to-copy rather than a mailto: link. */
export const SUPPORT_EMAIL = "brothers@seekflowstate.com";

/**
 * The transcription of the handwritten sample page
 * (assets/sample-handwriting.pdf) — the same page the web and mobile
 * onboarding transcribe, so the three surfaces show the same note. The two
 * must say the same thing: re-transcribe if the image is replaced.
 *
 * Formatted exactly like a real delivery: body text, then the embedded
 * original underneath.
 *
 * ⚠️ User-facing copy — follow the Flowstate voice guides before editing.
 */
export function sampleNoteContent(attachmentPath: string): string {
  return `I was going to write Lorem Ipsum here 47 times like they do for filler copy, but then I thought — "huh, where does Lorem Ipsum even come from?" So I looked it up.

- It comes from Cicero in ancient Rome, almost 2000 years ago.
- Lorem Ipsum are two first words of a book he wrote.
- Or actually, it's a truncation of the first two words — "dolorem ipsum" — which means "pain itself." No wonder they use it to describe writing!

Hope you enjoyed this little tidbit and the rest of Flowstate. We made it for writers, thinkers, notetakers, and people like us who just want to feel a little bit more human again!

— Raj

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
 * Write the sample note + handwritten page into the vault (the user opted in
 * by clicking the sample link in the welcome screen — never call this without
 * that consent). Returns the
 * note's path.
 */
export async function installSampleNote(app: App): Promise<string> {
  // No baseFolder: this is the exact call a real delivery makes
  // (see maybeDownloadOriginal in main.ts), so the PDF lands in the user's
  // configured attachment folder and is linked from the note the same way.
  const pdfPath = await writeBinaryToAttachments(
    app,
    `${SAMPLE_NOTE_TITLE}.pdf`,
    base64ToBytes(SAMPLE_PDF_BASE64)
  );
  // Vault root, not the flow's folder: the sample is a demo, not a delivery,
  // and burying it in a folder the user hasn't opened yet hides the payoff.
  const notePath = normalizePath(`${SAMPLE_NOTE_TITLE}.md`);
  await atomicWrite(app, notePath, sampleNoteContent(pdfPath));
  log("firstRun: sample note installed", { notePath, pdfPath });
  return notePath;
}

/**
 * Open the ephemeral welcome view (no vault writes). Reuses an already-open
 * welcome tab rather than stacking a second one — signing in from the welcome
 * screen's own CTA re-opens it in its signed-in form.
 */
export async function openWelcomeView(
  plugin: FlowStatePlugin,
  flowEmail: string | null,
  sampleAdded = false
): Promise<void> {
  const leaf = plugin.app.workspace.getLeavesOfType(WELCOME_VIEW_TYPE)[0]
    ?? plugin.app.workspace.getLeaf(true);
  await leaf.setViewState({ type: WELCOME_VIEW_TYPE, active: true, state: { flowEmail, sampleAdded } });
  await plugin.app.workspace.revealLeaf(leaf);
}

/**
 * Open the welcome screen on its own, resolving the flow email if a session is
 * available. Used by the dev command so the screen can be reviewed without
 * signing out and back in; harmless if signed out (the email bullet is simply
 * omitted).
 */
export async function openWelcomeScreenNow(plugin: FlowStatePlugin): Promise<void> {
  let flowEmail: string | null = null;
  try {
    const supabase = getSupabase(plugin.settings);
    const handle = await fetchUserHandle(supabase);
    const connectionId = await plugin.getMyConnectionId();
    const routes = connectionId ? await listObsidianRoutes(supabase, connectionId) : [];
    flowEmail = computeFlowEmail(handle, routes[0]?.slug, DEFAULT_INGEST_EMAIL_DOMAIN);
  } catch (e) {
    warn("openWelcomeScreenNow: could not resolve flow email", e);
  }
  await openWelcomeView(plugin, flowEmail);
}

/**
 * The welcome screen shown right after first sign-in — every time, whether or
 * not the user took the sample note — and, since the intro modal grew a
 * "Learn more" button, also to signed-out readers deciding whether to sign
 * up. It carries the getting-started information (the sample note is just a
 * fun optional demo). Formatted the way a real transcription lands so the
 * user sees the end state before they've captured anything. Rendered in an
 * ephemeral view (see welcomeView.ts) — it is never written to the vault.
 *
 * The two variants share every word except the Flows tense (signed-out
 * readers don't have an Inbox flow yet) and the bottom CTA card: sign-in when
 * signed out, upload when signed in.
 *
 * ⚠️ User-facing copy — follow the Flowstate voice guides before editing.
 */
export function welcomeNoteContent(
  flowEmail: string | null,
  sampleAdded = false,
  signedIn = true
): string {
  const emailLine = flowEmail
    ? `- Email photos of notes or audio files to your unique address: \`${flowEmail}\`\n`
    : "";
  // Nothing is written to the vault until the sample link below is clicked, so
  // both the offer and the no-writes promise flip once it has been.
  // Rendered as a paragraph containing only this link, so welcomeView can
  // replace the whole paragraph with the CTA card. Left as a working link if
  // that replacement ever fails.
  const sampleCta = `[${SAMPLE_CTA.button}](${SAMPLE_ACTION_HREF})`;
  // Same placeholder trick as the sample link: a paragraph holding only this
  // link, which welcomeView swaps for the CTA card matching the signed-in
  // state.
  const bottomCta = `[${(signedIn ? UPLOAD_CTA : GET_STARTED_CTA).button}](${BOTTOM_CTA_HREF})`;
  const flowsSentence = signedIn
    ? `We already made you a Flow called \`${STARTER_FLOW_NAME}\` that saves to a \`${STARTER_FOLDER}\` folder.`
    : `When you sign up, we'll make you a Flow called \`${STARTER_FLOW_NAME}\` that saves to a \`${STARTER_FOLDER}\` folder.`;
  return `# Welcome to Flowstate

[Flowstate](https://seekflowstate.com) turns handwritten pages and voice memos into clean, searchable text files in your Vault, saved exactly where you want them to go.

## How it works

1. **Share your handwriting or voice.** Snap a photo from your paper notebook. Record a voice memo. Email a PDF from your e-ink tablet.
2. **Flowstate cleans it up.** Flowstate does more than just transcribe. With custom instructions, it can also understand your shorthand & symbols, summarize what you wrote, translate it, and much more.
3. **Your notes show up automatically.** Flowstate names your notes the way you want and saves them to your Vault exactly where you want.

## Try it now

${sampleCta}

## Capture your notes

How you can send your notes to Flowstate:

- [Upload a file](${UPLOAD_ACTION_HREF}) straight from this computer — images, PDFs, or audio.
- Snap a handwritten page or record a voice memo in the [Flowstate app](https://seekflowstate.com).
${emailLine}
A minute later, it lands in your Vault, with your original file attached.

## Flows

By creating different Flows, you can choose how different notes get transcribed and where they get saved. ${flowsSentence} Add more Flows anytime in [Flowstate Settings](${SETTINGS_ACTION_HREF}).

## Credits

Flowstate uses AI to transcribe your notes. Each page of handwriting or minute of audio costs one credit, and you start with 25 free. When you're running low, top up anytime: $5 for 100 credits, $10 for 300, or $20 for 1,000. Top-ups never expire.

## Get started

${bottomCta}

Now go scribble something.

— Raj and Rob

*P.S. Having issues, or have ideas to make Flowstate better? Email us at \`${SUPPORT_EMAIL}\`.*
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
 *  - open the welcome screen (an ephemeral view — never written to the
 *    vault), which carries the getting-started information and offers the
 *    sample note as a link the user can choose to click
 *
 * Nothing is written to the vault here; the first write happens only if the
 * user clicks the sample link, or when a real transcription is delivered.
 * Runs at most once per account (tracked in
 * settings.starterSetupUsers) and never for accounts that already have flows
 * here. Best-effort: any failure logs and returns false rather than
 * interrupting sign-in.
 *
 * Returns true when the welcome screen was opened (i.e. this was a genuinely
 * fresh account for this vault).
 *
 * `force` is the dev-only replay path (see FlowStatePlugin.replayOnboarding):
 * it ignores both once-only gates so the flow can be re-run in a vault that is
 * already set up. It still never creates a second starter flow.
 */
export async function runFirstSignInSetup(
  plugin: FlowStatePlugin,
  opts: { force?: boolean } = {}
): Promise<boolean> {
  const force = opts.force === true;
  try {
    const supabase = getSupabase(plugin.settings);
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) throw userErr;
    const uid = userData.user?.id;
    if (!uid) return false;

    const done = plugin.settings.starterSetupUsers ?? [];
    if (!force && done.includes(uid)) return false;

    const connectionId = await plugin.getMyConnectionId();
    if (!connectionId) return false;

    const existing = await listObsidianRoutes(supabase, connectionId);
    // A forced replay shows the flow even in a vault that already has flows;
    // the starter-flow creation below stays keyed off the real emptiness check
    // so it never spawns a duplicate Inbox.
    const hasNoFlows = existing.length === 0;
    const isFresh = hasNoFlows || force;

    let route: Route | null = existing[0] ?? null;
    if (hasNoFlows) {
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
    plugin.settings.starterSetupUsers = done.includes(uid) ? done : [...done, uid];
    await plugin.saveSettings();

    if (!isFresh) return false;

    let flowEmail: string | null = null;
    try {
      const handle = await fetchUserHandle(supabase);
      flowEmail = computeFlowEmail(handle, route?.slug, DEFAULT_INGEST_EMAIL_DOMAIN);
    } catch (e) {
      warn("firstRun: could not resolve flow email for welcome screen", e);
    }

    // Straight to the welcome screen — no interstitial. It carries the
    // getting-started information, and the sample note is offered as a link
    // inside it, so the plugin still writes nothing to the vault unprompted.
    await openWelcomeView(plugin, flowEmail);
    log("firstRun: welcome screen opened", { flowEmail: !!flowEmail });
    return true;
  } catch (e) {
    warn("firstRun: setup failed (continuing without it)", e);
    return false;
  }
}
