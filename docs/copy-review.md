# Copy review — onboarding & capture (PR draft)

Every user-facing string added in this PR, grouped by surface, for review
against the Flowstate voice guides. **Edit the text right here** (or comment on
the PR) and I'll apply the changes to the code — each string has an ID so you
can reference it. `{braces}` mark runtime values.

> Written to the CLAUDE.md voice anchors (warm, plain-spoken, sentence case,
> janitor-not-author, no banned words) but **not** yet checked against the
> Basecamp style docs, which aren't reachable from the dev environment.

---

## 1. Onboarding modal (`src/onboarding.ts`)

First screen — shown once on plugin load while signed out.

| ID    | Where             | Text                                                         |
|-------|-------------------|--------------------------------------------------------------|
| OB-1  | Title             | Flowstate                                                    |
| OB-2  | Intro             | [Flowstate](https://seekflowstate.com) turns handwriting and voice into text files, and saves them automatically to your Vault. |
| OB-3  | Step 1 title      | Write by hand, or record your voice                          |
| OB-4  | Step 1 body       | Use pen & paper, e-ink tablets, or talk out loud             |
| OB-5  | Step 2 title      | Share it with Flowstate                                      |
| OB-6  | Step 2 body       | Upload a file, send in an email, or use the Flowstate app    |
| OB-7  | Step 3 title      | See notes saved to your Vault, automatically                 |
| OB-8  | Step 3 body       | Flowstate transcribes and saves them exactly where you want  |
| OB-9  | Sign-in label     | Enter your email to get a login code                         |
| OB-10 | Email placeholder | you@example.com                                              |
| OB-11 | CTA button        | Get started                                                  |

Code-entry step:

| ID    | Where            | Text                                                         |
|-------|------------------|--------------------------------------------------------------|
| OB-13 | Title            | Check your email                                             |
| OB-14 | Body             | We sent a sign-in code to **{email}**. Type it below, or click the link (just make sure if you click, it's on this device). |
| OB-15 | Code placeholder | 6-digit code                                                 |
| OB-16 | CTA button       | Sign in                                                      |
| OB-17 | Link             | Resend code                                                  |
| OB-18 | Link             | Use a different email                                        |

Notices:

| ID    | Trigger     | Text                            |
|-------|-------------|---------------------------------|
| OB-19 | Empty email | Enter your email address first  |
| OB-20 | Send failed | Couldn't send the code: {error} |
| OB-21 | Resent      | Code re-sent to {email}         |
| OB-22 | Empty code  | Enter the code from your email  |
| OB-23 | Signed in   | HUZZAH! Welcome to Flowstate!   |
| OB-24 | Bad code    | That code didn't work: {error}  |

Command palette entries (`src/main.ts`), both hidden unless an admin account (see `ADMIN_EMAILS`) has signed in on this vault: **ST-0** "Onboarding (dev)" replays the whole first-run sequence (intro modal → sign-in → welcome screen); "Onboarding (dev): welcome screen" opens just the welcome screen, skipping sign-in.

---

## 2. Settings — sign in (`src/settings.ts`)

| ID   | Where                    | Text                                                         |
|------|--------------------------|--------------------------------------------------------------|
| ST-1 | Row name                 | Sign up or sign in                                           |
| ST-2 | Row description          | Enter your email and we'll send you a sign-in code. New accounts start with 25 free credits. |
| ST-3 | Button                   | Send code                                                    |
| ST-4 | Code state — row name    | Enter your code                                              |
| ST-5 | Code state — description | We sent a sign-in code to **{email}**. Type it below, or click the link (just make sure if you click, it's on this device). |
| ST-6 | Button                   | Sign in                                                      |
| ST-7 | Links                    | Resend code · Use a different email                          |
| ST-8 | Resend failed notice     | Couldn't resend: {error}                                     |

(Sign-in success and bad-code notices reuse OB-23 / OB-24.)

Signed-in account bar (replaces the old Account row + Credits section):

| ID | Where | Text |
|----|-------|------|
| ST-9 | Credits chip | {n} credit(s) — or "Unlimited" |
| ST-10 | Chip hover tooltip | Subscription: {x} (rolls over while subscribed) · Top-ups: {y} (never expire) |
| ST-11 | Buttons | Manage credits · Log out |

Recent uploads section:

| ID | Where | Text |
|----|-------|------|
| ST-12 | Section heading | Recent uploads |
| ST-13 | Empty state | Nothing here yet — send something and it'll show up. |
| ST-14 | Status labels | Delivered · Syncing… · Processing… · {error message} when failed |
| ST-15 | Link | Full history in the web app → |
| ST-16 | Load failure | Couldn't load recent uploads |

---

## 4. Handwritten sample page + sample note (`assets/sample-handwriting.pdf`, `src/firstRun.ts` → `sampleNoteContent`)

The bundled page is the handwritten sample page as the capture pipeline's
single-page PDF (borderless — the page box is the image). It is written to the
user's configured attachment folder and embedded from the note exactly like a
real delivery. The web and mobile onboarding still ship an older bordered crop
of the same page; refreshing those is a separate change. The note body is its word-for-word transcription. **If the image is
replaced, re-transcribe this text and run `node scripts/embed-sample-pdf.mjs`.**
ID **SN-6**:

> I was going to write Lorem Ipsum here 47 times like they do for filler copy, but then I thought — "huh, where does Lorem Ipsum even come from?" So I looked it up.
>
> - It comes from Cicero in ancient Rome, almost 2000 years ago.
> - Lorem Ipsum are two first words of a book he wrote.
> - Or actually, it's a truncation of the first two words — "dolorem ipsum" — which means "pain itself." No wonder they use it to describe writing!
>
> Hope you enjoyed this little tidbit and the rest of Flowstate. We made it for writers, thinkers, notetakers, and people like us who just want to feel a little bit more human again!
>
> — Raj

Note title (the filename in the vault): **Where Lorem Ipsum comes from**.

---

## 5. Welcome screen (`src/firstRun.ts` → `welcomeNoteContent`)

Ephemeral view shown immediately after first sign-in — no interstitial modal. It
carries the getting-started information and offers the sample note as a CTA card,
so the plugin still writes nothing to the vault unprompted. Reachable again via
the **Learn more →** link at the top of Settings → Flowstate (signed in only).

Three links in it run code rather than navigating (wired in `welcomeView.ts`):
`flowstate:upload` opens the upload modal, `flowstate:settings` opens this
plugin's settings tab, and both `code`-formatted email addresses copy to the
clipboard on click. ID **WV-1** (full markdown):

> # Welcome to Flowstate
>
> [Flowstate](https://seekflowstate.com) turns handwritten pages and voice memos into clean, searchable text files in your Vault, saved exactly where you want them to go.
>
> ## How it works
>
> 1. **Share your handwriting or voice.** Snap a photo from your paper notebook. Record a voice memo. Email a PDF from your e-ink tablet.
> 2. **Flowstate cleans it up.** Flowstate does more than just transcribe. With custom instructions, it can also understand your shorthand & symbols, summarize what you wrote, translate it, and much more.
> 3. **Your notes show up automatically.** Flowstate names your notes the way you want and saves them to your Vault exactly where you want.
>
> ## Try it now
>
> _(CTA card — see WV-2 below)_
>
> ## Capture your notes
>
> How you can send your notes to Flowstate:
>
> - [Upload a file](flowstate:upload) straight from this computer — images, PDFs, or audio.
> - Snap a handwritten page or record a voice memo in the [Flowstate app](https://seekflowstate.com).
> - Email photos of notes or audio files to your unique address: `{flow email}`
>
> A minute later, it lands in your Vault, with your original file attached.
>
> ## Flows
>
> By creating different Flows, you can choose how different notes get transcribed and where they get saved. We already made you a Flow called `Inbox` that saves to a `Flowstate` folder. Add more Flows anytime in [Flowstate Settings](flowstate:settings).
>
> ## Credits
>
> Flowstate uses AI to transcribe your notes. Each page of handwriting or minute of audio costs one credit, and you start with 25 free.
>
> Now go scribble something.
>
> — Raj and Rob
>
> *P.S. Having issues, or have ideas to make Flowstate better? Email us at `brothers@seekflowstate.com`.*

CTA card copy lives in `SAMPLE_CTA` (`welcomeView.ts` builds it). **WV-2**, before:

> We wrote you a real handwritten page, so you can see what it looks like in your Vault.
> `[ See a sample note ]`

**WV-3**, after:

> Added a sample note to your vault.
> `[ Open it ]`
## 6. Settings — Capture section (`src/settings.ts`)

| ID   | Where                  | Text                                                         |
|------|------------------------|--------------------------------------------------------------|
| CP-1 | Section header         | Capture                                                      |
| CP-2 | Intro                  | Capture from your phone, by email (each flow has its own address — see its Email Options), or upload right here. Transcriptions land back in this vault on their own. |
| CP-3 | App row name           | Flowstate app                                                |
| CP-4 | App row description    | Snap handwritten pages or record voice memos, then send them straight to this vault. |
| CP-5 | App row button         | Get the app                                                  |
| CP-6 | Upload row name        | Upload a file                                                |
| CP-7 | Upload row description | Send handwriting or audio from this computer: images, PDFs, and audio files. |
| CP-8 | Upload row button      | Upload                                                       |

---

## 7. Get-the-app modal (`src/getAppModal.ts`)

| ID | Where | Text |
|----|-------|------|
| GA-1 | Title | Get the Flowstate app |
| GA-2 | Body | Snap handwritten pages or record voice memos on your phone, and send them straight to this vault. |
| GA-3 | QR caption | Scan with your phone's camera |
| GA-4 | Download line | Download links live at [seekflowstate.com](https://seekflowstate.com). |
| GA-5 | Web app line | Prefer a browser? [Open the web app →](https://app.startflow.ing) |

---

## 8. Upload modal (`src/uploadModal.ts`)

| ID    | Where                         | Text                                                         |
|-------|-------------------------------|--------------------------------------------------------------|
| UP-1  | Title                         | Upload to Flowstate                                          |
| UP-2  | Intro                         | Send handwriting or audio straight from this computer. Images, PDFs, and audio files — one credit per page or minute. |
| UP-3  | Files row name                | Files                                                        |
| UP-4  | Files row description (empty) | Images, PDFs, or audio. Pick several to batch.               |
| UP-5  | Buttons                       | Choose files / Add more                                      |
| UP-6  | Per-file meta                 | {size} MB · ~{n} credit(s) · "estimating…" while pending     |
| UP-7  | Remove link                   | Remove                                                       |
| UP-8  | Mixing error (audio)          | Can't mix audio files with images or PDFs.                   |
| UP-9  | Mixing error (PDF)            | Can't mix PDF files with images. Upload either a PDF or images. |
| UP-10 | Flow row name                 | Flow                                                         |
| UP-11 | Flow row description          | Where the transcription gets filed.                          |
| UP-12 | New-flow dropdown option      | ➕ New flow…                                                  |
| UP-13 | New flow name row             | New flow name (placeholder: Journal)                         |
| UP-14 | Destination row               | Destination folder — Created if it doesn't exist. Change it later in the flow's settings. (placeholder: Flowstate) |
| UP-15 | Instructions row name         | File instructions                                            |
| UP-16 | Instructions description      | Optional. Applies to this upload only, on top of the flow's own instructions. |
| UP-17 | Instructions placeholder      | e.g., "Summarize in bullet points"                           |
| UP-18 | Summary line                  | Estimated credits: {n} · you have {balance} (or "you have Unlimited") |
| UP-19 | Over-balance warning          | That's more than your balance — the upload may not finish. Top up in Credits below. |
| UP-20 | Fine print                    | Estimates. The final count is pages and audio minutes, tallied after processing. |
| UP-21 | Buttons                       | Cancel / Upload {n} file(s) / Uploading {i}/{n}…             |

Notices:

| ID | Trigger | Text |
|----|---------|------|
| UP-22 | HEIC file | {file}: HEIC photos aren't supported here yet — use the Flowstate app, or convert to JPG first. |
| UP-23 | Too large | {file} is too large. Maximum size is 100MB. |
| UP-24 | New flow unnamed | Give your new flow a name first. |
| UP-25 | Success | {n} file(s) sent to Flowstate. The notes land in your vault in a minute or two. |
| UP-26 | Command palette entry (`src/main.ts`) | Upload a file |
| UP-27 | Command while signed out | Flowstate: sign in first — open Settings → Flowstate. |

---

## 9. Delivery notices (`src/firstRun.ts`, fired from `src/main.ts`)

| ID | Trigger | Text |
|----|---------|------|
| DL-1 | First-ever synced note (one-time, 10s) | Your first note just landed: "{note name}". Flowstate will keep delivering new notes automatically. |
| DL-2 | Every later delivery | Flowstate: {n} new note(s) in your vault |
