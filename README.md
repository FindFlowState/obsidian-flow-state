# Flow State (Obsidian Plugin)

[Flow State](https://findflow.ai) is the missing bridge between your offline notes and your digital brain. The app transcribes handwritten notes and voice memos using AI, and automatically stores the files exactly where you want in your Obsidian vault and other apps.

## Features

- **AI-powered transcription:** Handwritten notes and audio recordings are transcribed using advanced AI, with automatic file naming based on content.
- **Enrichment options:** Go beyond transcription—translate, summarize, add context, extract action items, turn circled words into hashtags, and more.
- **Custom destinations:** Choose the exact location in your vault where you want your notes saved. Create different destinations for different projects.
- **Append mode:** Create new files for each note, or append to an existing file with auto-generated headings.
- **Download originals:** Optionally save the original handwriting images or audio files to your vault.
- **Multiple projects:** Create separate projects for different kinds of notes, each with its own instructions and save location.
- **Email upload:** Get a unique email address for each project to send handwritten notes and voice memos for transcription.

## Installation & Setup

### Requirements
- Obsidian v1.2.0 or newer
- A Flow State account (free to create)

### Install from Community Plugins
1. Open Obsidian Settings → Community plugins
2. Search for "Flow State"
3. Click Install, then Enable

### Manual Installation
1. Download the latest release assets: `manifest.json`, `main.js` (and `styles.css` if present)
2. Place them in your vault at `.obsidian/plugins/flow-state/`
3. In Obsidian, enable the plugin (Settings → Community plugins)

### Connect Your Account
1. Open Settings → Community plugins → Flow State
2. Enter your email and press **Connect** to receive a Magic Link
3. Check your email and click the link to sign in (check spam if needed)

If you don't have a Flow State account, one will automatically be created for you.

## Using the Plugin

### Create a Project
Projects control where and how notes are saved. You can create multiple projects to handle different types of notes differently.

**Settings:**
- **Name:** A descriptive name for your project
- **Append to existing:** Toggle on to append all notes to a single file (with AI-generated headings), or off to create new files
- **Destination:** Choose a vault folder (for new files) or an existing file (for append mode)

**Save Options:**
- **Download Original:** Save the original handwriting image or audio file to your vault
- **File Name / Note Heading Instructions:** Customize how AI generates titles (e.g., "Keep it short", "Include the date")

**Enrichment Options:**
- **Instructions:** Tell Flow State's AI how to process your notes beyond basic transcription. Examples: "Translate to Spanish", "Add context and book suggestions", "Turn circled words into hashtags"

**Email Options** (after creating a project):
- **Project Tag:** A unique identifier used in your project's email address
- **Project Email:** Send files to this address to auto-transcribe and save to this project

### Send a Note
There are several ways to send notes to Flow State:
- **Email:** Send to your project's unique email address (supports 1 PDF, 1 audio file, or multiple PNG/JPG images)
- **Mobile app:** Upload through the [Flow State mobile app](https://findflow.ai)

### Sync Your Files
After you send a note, Flow State transcribes it using your project's settings. The plugin automatically syncs completed transcriptions into your vault. You can also manually sync by clicking the **Sync** button in settings.

## Privacy
- No analytics or tracking are included in this plugin
- Only your Flow State outputs (and optionally original files) are written to your vault
- Flow State does not view or store any other files from your vault

## Troubleshooting
- **Email address not showing:** Email options appear only after a project is created and saved
- **Auth errors:** Try signing out and connecting again
- **Notes not syncing:** Click the Sync button manually, or check that Obsidian is running

## Support
- Website: [findflow.ai](https://findflow.ai)
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
