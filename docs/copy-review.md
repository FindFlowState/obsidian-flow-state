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

| ID | Where | Text |
|----|-------|------|
| OB-1 | Title | Your handwriting, in your vault |
| OB-2 | Intro | Flowstate transcribes handwritten pages and voice memos and files them here as clean, searchable markdown. The words stay yours — we just do the typing. |
| OB-3 | Step 1 title | Write or record |
| OB-4 | Step 1 body | On paper, an e-ink tablet, or out loud as a voice memo. |
| OB-5 | Step 2 title | Capture it |
| OB-6 | Step 2 body | Snap it with the Flowstate app, or email it from your reMarkable, Boox, or Supernote. |
| OB-7 | Step 3 title | It lands here |
| OB-8 | Step 3 body | Transcribed, formatted, and filed in this vault — right where you told it to go. |
| OB-9 | Credits line | Your first 50 pages are free. No card, no catch. |
| OB-10 | Email placeholder | you@example.com |
| OB-11 | CTA button | Get started |
| OB-12 | Dismiss link | Maybe later |

Code-entry step:

| ID | Where | Text |
|----|-------|------|
| OB-13 | Title | Check your email |
| OB-14 | Body | We sent a sign-in code to **{email}**. Type it below — or click the link in that email on this device. |
| OB-15 | Code placeholder | 6-digit code |
| OB-16 | CTA button | Sign in |
| OB-17 | Link | Resend code |
| OB-18 | Link | Use a different email |

Notices:

| ID | Trigger | Text |
|----|---------|------|
| OB-19 | Empty email | Enter your email address first |
| OB-20 | Send failed | Couldn't send the code: {error} |
| OB-21 | Resent | Code re-sent to {email} |
| OB-22 | Empty code | Enter the code from your email |
| OB-23 | Signed in | You're in. Welcome to Flowstate! |
| OB-24 | Bad code | That code didn't work: {error} |

Command palette entry (`src/main.ts`): **ST-0** "Get started"

---

## 2. Settings — sign in (`src/settings.ts`)

| ID | Where | Text |
|----|-------|------|
| ST-1 | Row name | Sign up or sign in |
| ST-2 | Row description | Enter your email and we'll send you a sign-in code. New accounts start with 50 free credits. |
| ST-3 | Button | Send code |
| ST-4 | Code state — row name | Enter your code |
| ST-5 | Code state — description | We emailed a sign-in code to {email}. Type it here — or click the link in that email on this device. |
| ST-6 | Button | Sign in |
| ST-7 | Links | Resend code · Use a different email |
| ST-8 | Resend failed notice | Couldn't resend: {error} |

(Sign-in success and bad-code notices reuse OB-23 / OB-24.)

---

## 3. Sample note offer (`src/sampleNoteModal.ts`)

Shown once, right after first sign-in. Opting in is the permission to write
the two sample files.

| ID | Where | Text |
|----|-------|------|
| SN-1 | Title | Want to see a sample note? |
| SN-2 | Body | We wrote you a welcome letter by hand and ran it through Flowstate. We can drop the result into your Flowstate folder: the transcribed note, with the handwritten page attached underneath — exactly what a delivery looks like. |
| SN-3 | Fine print | That's two small files in your vault. Delete them anytime. Skip, and we'll show you a preview instead — nothing gets written. |
| SN-4 | Skip button | Just show a preview |
| SN-5 | CTA button | Add sample note |

---

## 4. Handwritten letter + sample note (`assets/welcome-sample.pdf`, `src/firstRun.ts` → `sampleNoteContent`)

The letter and its "transcription" are word-for-word identical. **If this text
changes, the PDF must be re-made** (write/scan it again or regenerate, then run
`node scripts/embed-welcome-pdf.mjs`). ID **SN-6**:

> Welcome to Flowstate
>
> If you can read this, everything worked — this page started as ink on paper.
>
> Write on paper. Capture it with the Flowstate app, or email it from your e-ink tablet. A minute later it lands in your vault as clean, searchable text — filed wherever you told it to go.
>
> The words stay yours. Flowstate just does the typing.
>
> You have 50 free credits — one page of handwriting or one minute of audio each.
>
> Go scribble something.
>
> — Raj and Rob

---

## 5. Welcome preview screen (`src/firstRun.ts` → `welcomeNoteContent`)

Ephemeral view shown when the user skips the sample note. Never written to the
vault. ID **WV-1** (full markdown):

> # Welcome to Flowstate
>
> Your handwriting and voice memos will land in your vault looking a lot like this: clean, searchable text, filed exactly where you told it to go.
>
> Here's the whole trick:
>
> 1. **Write on paper.** Or an e-ink tablet. Or think out loud into a voice memo.
> 2. **Capture it.** Snap it with the [Flowstate app](https://seekflowstate.com), or email it straight from your reMarkable, Boox, or Supernote.
> 3. **It lands in your vault.** Transcribed, formatted, and filed by your flows. The words stay yours — Flowstate just does the typing.
>
> We already made you a flow called **Inbox** that saves to a `Flowstate` folder. Point it somewhere else, rename it, or add more flows any time in **Settings → Flowstate**.
>
> ## Try it now
>
> - Email a photo of a page (or a voice memo) to your Inbox flow: `{flow email}`
> - Or grab the [Flowstate app](https://seekflowstate.com) and snap a photo of anything handwritten within arm's reach.
>
> A minute later, it lands in your `Flowstate` folder as a real note.
>
> You have 50 free credits to play with — one page of handwriting or one minute of audio each. Go scribble something.
>
> *This screen is just a preview — Flowstate won't write anything to your vault until you send it something.*
>
> — Raj and Rob

---

## 6. Settings — Capture section (`src/settings.ts`)

| ID | Where | Text |
|----|-------|------|
| CP-1 | Section header | Capture |
| CP-2 | Intro | Capture from your phone, by email (each flow has its own address — see its Email Options), or upload right here. Transcriptions land back in this vault on their own. |
| CP-3 | App row name | Flowstate app |
| CP-4 | App row description | Snap handwritten pages or record voice memos, then send them straight to this vault. |
| CP-5 | App row button | Get the app |
| CP-6 | Upload row name | Upload a file |
| CP-7 | Upload row description | Send handwriting or audio from this computer: images, PDFs, and audio files. |
| CP-8 | Upload row button | Upload |

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

| ID | Where | Text |
|----|-------|------|
| UP-1 | Title | Upload to Flowstate |
| UP-2 | Intro | Send handwriting or audio straight from this computer. Images, PDFs, and audio files — one credit per page or minute. |
| UP-3 | Files row name | Files |
| UP-4 | Files row description (empty) | Images, PDFs, or audio. Pick several to batch. |
| UP-5 | Buttons | Choose files / Add more |
| UP-6 | Per-file meta | {size} MB · ~{n} credit(s) · "estimating…" while pending |
| UP-7 | Remove link | Remove |
| UP-8 | Mixing error (audio) | Can't mix audio files with images or PDFs. |
| UP-9 | Mixing error (PDF) | Can't mix PDF files with images. Upload either a PDF or images. |
| UP-10 | Flow row name | Flow |
| UP-11 | Flow row description | Where the transcription gets filed. |
| UP-12 | New-flow dropdown option | ➕ New flow… |
| UP-13 | New flow name row | New flow name (placeholder: Journal) |
| UP-14 | Destination row | Destination folder — Created if it doesn't exist. Change it later in the flow's settings. (placeholder: Flowstate) |
| UP-15 | Instructions row name | File instructions |
| UP-16 | Instructions description | Optional. Applies to this upload only, on top of the flow's own instructions. |
| UP-17 | Instructions placeholder | e.g., "Summarize in bullet points" |
| UP-18 | Summary line | Estimated credits: {n} · you have {balance} (or "you have Unlimited") |
| UP-19 | Over-balance warning | That's more than your balance — the upload may not finish. Top up in Credits below. |
| UP-20 | Fine print | Estimates. The final count is pages and audio minutes, tallied after processing. |
| UP-21 | Buttons | Cancel / Upload {n} file(s) / Uploading {i}/{n}… |

Notices:

| ID | Trigger | Text |
|----|---------|------|
| UP-22 | HEIC file | {file}: HEIC photos aren't supported here yet — use the Flowstate app, or convert to JPG first. |
| UP-23 | Too large | {file} is too large. Maximum size is 100MB. |
| UP-24 | New flow unnamed | Give your new flow a name first. |
| UP-25 | Success | {n} file(s) sent to Flowstate. The notes land in your vault in a minute or two. |

---

## 9. Delivery notices (`src/firstRun.ts`, fired from `src/main.ts`)

| ID | Trigger | Text |
|----|---------|------|
| DL-1 | First-ever synced note (one-time, 10s) | Your first note just landed: "{note name}". Flowstate will keep delivering new notes automatically. |
| DL-2 | Every later delivery | Flowstate: {n} new note(s) in your vault |
