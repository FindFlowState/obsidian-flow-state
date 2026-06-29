# Using the plugin

### Create a Flow

Flows control where and how notes are saved. You can create multiple flows to handle different types of notes differently.

1. Open **Settings → Community plugins → Flowstate**
2. Click **Add Flow**
3. Configure your flow settings (see below)
4. Click **Save**

#### Basic Settings

- **Name:** A descriptive name for your flow (e.g., "Journal Entries", "Meeting Notes")
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

- **Instructions:** Tell Flowstate's AI how to process your notes beyond basic transcription. Examples:
  - "Translate to Spanish"
  - "Summarize in bullet points"
  - "Extract action items and format as a checklist"
  - "Add context and book suggestions"
  - "Turn circled words into hashtags"

#### Email Options (expandable section, available after saving)

- **Flow Tag:** A unique identifier used in your flow's email address
- **Flow Email:** Send files to this address to auto-transcribe and save to this flow

### Send a Note

There are several ways to send notes to Flowstate:

- **Mobile app:** Take a photo or record audio in the [Flowstate mobile app](https://seekflowstate.com), then tap to upload
- **Email:** Send to your flow's unique email address
  - Supports: 1 PDF, 1 audio file, or multiple PNG/JPG images (combined into one note)
  - Subject line is ignored—the AI generates a title from the content

### Sync Your Files

Flowstate automatically syncs completed transcriptions to your vault. Here's how it works:

- **Automatic background sync:** The plugin checks for new files every minute (desktop) or 5 minutes (mobile)
- **Command palette:** Press `Cmd/Ctrl + P` and search for "Flowstate: Sync Now"

When you upload from the mobile app, Flowstate can automatically open the synced note in Obsidian once it's ready.

### Credits

Each page or minute of audio uses one credit. You get 50 free credits to get started.

To check your balance, open Settings → Flowstate → expand the **Credits** section.

Need more credits? Click **Manage Credits** to upgrade your plan or buy top-ups.

## Privacy

- No usage analytics or behavioral tracking are included in this plugin
- Production builds include crash reporting via [Sentry](https://sentry.io) to help us fix bugs. It captures only errors originating from this plugin, sends no personally identifiable information, and collects no performance or usage data
- Only your Flowstate outputs (and optionally original files) are written to your vault
- Flowstate does not read or access any other files in your vault

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **Flow email address not showing** | Email options only appear after a flow is saved. Create the flow first, then edit it to see email options. |
| **Magic link not working** | Check your spam folder. Make sure you click the link on the same device where Obsidian is open. |
| **Notes not syncing** | Wait a minute for the automatic background sync, or trigger it manually from the command palette ("Flowstate: Sync Now"). |
| **"Not signed in" error** | Go to Settings → Flowstate and reconnect your account. |
| **Destination folder not found** | The plugin auto-creates folders, but make sure the path is valid. Edit your flow and re-select the destination. |

## Support

- Website: [seekflowstate.com](https://seekflowstate.com)
- Issues: [GitHub Issues](https://github.com/FindFlowstate/obsidian-flow-state/issues)

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
