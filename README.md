# Flow State (Obsidian Plugin)

Turn handwritten notes and audio into polished notes in your Obsidian vault. This plugin connects your Flow State account to Obsidian so finished notes are saved exactly where you want them.

## What it does
- Pulls completed notes from your Flow State account.
- Saves new notes or appends to an existing note, based on your project settings.
- Names files using your Title Template (with a live preview and filename safety).
- Optionally saves the original file (e.g., image/audio) to your vault’s attachments.

## Requirements
- Obsidian v1.2.0 or newer.
- A Flow State account.

## Install
You can install from the Obsidian Community Plugins browser once approved. For manual install:
1. Download the latest release assets: `manifest.json`, `main.js` (and `styles.css` if present).
2. Place them in your vault at `.obsidian/plugins/flow-state-obsidian/`.
3. In Obsidian, enable the plugin (Settings → Community plugins).

## Connect your account
1. Open Settings → Community plugins → Flow State.
2. Enter your email and press Connect to receive a Magic Link.
3. Click the link to sign in. The plugin will connect your vault to your account.

## Projects
Projects control where and how notes are saved.
- Destination: choose a vault folder or an existing file to append to.
- Title Template: use variables like `{{ai_generated_title}}`, `{{date_iso}}`, `{{time_iso}}`, and `{{original_filename}}`.
- AI Title Suggestion: optionally add an AI-generated title into your template.
- Instructions: tell the AI how to format or transform your notes.

## Privacy
- The plugin connects to your Flow State account using Supabase authentication.
- Only your Flow State outputs (and optionally original files) are written to your vault.
- No analytics or tracking are included in this plugin.

## Troubleshooting
- Destination doesn’t exist: the plugin now creates missing folders/files when saving.
- Email address for uploads: shown only after a project is created.
- If you see auth errors, try signing out and connecting again.

## Development
Build requirements: Node 20+

Commands:
```sh
npm install
# Production bundle (outputs main.js next to manifest.json)
npm run build
# Local/dev bundle (outputs to dist/local with a dev manifest)
npm run build-local
```

## Release process
1. Update versions in `manifest.json`/`package.json`.
2. `npm run build` to produce `main.js`.
3. Create a GitHub release and upload: `manifest.json`, `main.js`, and `versions.json`.

## License
Non-commercial license. See `LICENSE` for details.
