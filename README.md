# FlowState (Obsidian Plugin)

[FlowState](https://seekflowstate.com) is the missing bridge between your offline notes and your digital brain. The app transcribes handwritten notes and voice memos using AI, and automatically syncs them to your Obsidian vault.

## Features

- **AI-powered transcription:** Handwritten notes and audio recordings are transcribed using advanced AI, with automatic file naming based on content.
- **Enrichment options:** Go beyond transcription—translate, summarize, add context, extract action items, turn circled words into hashtags, and more.
- **Custom destinations:** Choose the exact folder in your vault where you want your notes saved. Create different projects for different purposes.
- **Append mode:** Create new files for each note, or append to a single file with auto-generated headings.
- **Download originals:** Optionally save the original handwriting images or audio files as embedded attachments.
- **Multiple projects:** Create separate projects for different kinds of notes, each with its own AI instructions and save location.
- **Email upload:** Get a unique email address for each project to send handwritten notes and voice memos for transcription.
- **Automatic sync:** Notes sync to your vault automatically in the background—no manual action required.

## Installation & Setup

### Requirements
- Obsidian v1.2.0 or newer
- A FlowState account (free to create)

### Step 1: Download the Plugin

1. Go to the [latest release page](https://github.com/FindFlowState/obsidian-flow-state/releases/latest)
2. Under **Assets**, download these two files:
   - `main.js`
   - `manifest.json`

### Step 2: Install in Your Vault

1. Open your Obsidian vault folder in Finder (Mac) or File Explorer (Windows):
   - **Mac:** In Obsidian, right-click your vault name in the sidebar → "Reveal in Finder"
   - **Windows:** In Obsidian, right-click your vault name in the sidebar → "Show in system explorer"
2. Open the `.obsidian` folder (this folder may be hidden—see note below)
3. Open the `plugins` folder inside `.obsidian` (create it if it doesn't exist)
4. Create a new folder called `flow-state`
5. Move the downloaded `main.js` and `manifest.json` files into the `flow-state` folder

**Can't see the .obsidian folder?** It's hidden by default:
- **Mac:** Press `Cmd + Shift + .` to show hidden files
- **Windows:** In File Explorer, click View → Show → Hidden items

### Step 3: Enable the Plugin

1. Open Obsidian
2. Go to **Settings** (gear icon in the bottom-left)
3. Click **Community plugins** in the left sidebar
4. If prompted, click "Turn on community plugins"
5. Find **FlowState** in the list and toggle it **on**

### Step 4: Connect Your Account

1. Still in Settings, click **FlowState** under Community plugins
2. Enter your email address and click **Connect**
3. Check your email for a magic link and click it to sign in (check spam if needed)

If you don't have a FlowState account, one will be created automatically.

## Using the Plugin

### Create a Project

Projects control where and how notes are saved. You can create multiple projects to handle different types of notes differently.

1. Open **Settings → Community plugins → FlowState**
2. Click **Add Project**
3. Configure your project settings (see below)
4. Click **Save**

#### Basic Settings

- **Name:** A descriptive name for your project (e.g., "Journal Entries", "Meeting Notes")
- **Append to existing:**
  - **Off (default):** Each upload creates a new file in your destination folder
  - **On:** All uploads append to a single file, with AI-generated headings separating each entry
- **Destination:**
  - If append is off: Choose a folder where new files will be created
  - If append is on: Choose or create a file to append to

#### Save Options (expandable section)

- **Download Original:** When enabled, the original handwriting image or audio file is embedded in your note
- **File Name / Note Heading Instructions:** Customize how AI generates titles. Examples:
  - "Keep it short"
  - "Include the date"
  - "Use the main topic as the title"

#### Enrichment Options (expandable section)

- **Instructions:** Tell FlowState's AI how to process your notes beyond basic transcription. Examples:
  - "Translate to Spanish"
  - "Summarize in bullet points"
  - "Extract action items and format as a checklist"
  - "Add context and book suggestions"
  - "Turn circled words into hashtags"

#### Email Options (expandable section, available after saving)

- **Project Tag:** A unique identifier used in your project's email address
- **Project Email:** Send files to this address to auto-transcribe and save to this project

### Send a Note

There are several ways to send notes to FlowState:

- **Mobile app:** Take a photo or record audio in the [FlowState mobile app](https://seekflowstate.com), then tap to upload
- **Email:** Send to your project's unique email address
  - Supports: 1 PDF, 1 audio file, or multiple PNG/JPG images (combined into one note)
  - Subject line is ignored—the AI generates a title from the content

### Sync Your Files

FlowState automatically syncs completed transcriptions to your vault. Here's how it works:

- **Automatic background sync:** The plugin checks for new files every 2 minutes (desktop) or 5 minutes (mobile)
- **Manual sync:** Open Settings → FlowState → expand the **Sync** section → click **Sync Now**
- **Command palette:** Press `Cmd/Ctrl + P` and search for "FlowState: Sync Now"

When you upload from the mobile app, FlowState can automatically open the synced note in Obsidian once it's ready.

### Credits

Each page or minute of audio uses one credit. You get 50 free credits to get started.

To check your balance, open Settings → FlowState → expand the **Credits** section.

Need more credits? Click **Manage Credits** to upgrade your plan or buy top-ups.

## Privacy

- No analytics or tracking are included in this plugin
- Only your FlowState outputs (and optionally original files) are written to your vault
- FlowState does not read or access any other files in your vault

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **Project email address not showing** | Email options only appear after a project is saved. Create the project first, then edit it to see email options. |
| **Magic link not working** | Check your spam folder. Make sure you click the link on the same device where Obsidian is open. |
| **Notes not syncing** | Open Settings → FlowState → Sync → click "Sync Now". Check the sync logs for errors. |
| **"Not signed in" error** | Go to Settings → FlowState and reconnect your account. |
| **Destination folder not found** | The plugin auto-creates folders, but make sure the path is valid. Edit your project and re-select the destination. |

## Support

- Website: [seekflowstate.com](https://seekflowstate.com)
- Issues: [GitHub Issues](https://github.com/FindFlowState/obsidian-flow-state/issues)

## Development

Build requirements: Node 20+

```sh
npm install

# Production build
npm run build-prod

# Local development build
npm run build-local

# Run tests
npm test
```
