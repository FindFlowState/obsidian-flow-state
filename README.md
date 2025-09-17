# Flow State (Obsidian Plugin)

[Flow State](https://findflow.ai) is the missing bridge between your analog notes and your digital brain. The app transcribes handwritten notes and voice memos, and automatically stores the files exactly where you want in your cloud platforms and note-taking apps.

This plugin connects your Flow State account to Obsidian so you can seamlessly transcribe and save handwritten notes and audio files into your Obsidian vault. 

## Features
- **AI instructions:** Give custom instructions to our AI for how you want your notes transcribed. For example, you can tell it translate your notes into another language, or explain things that are you didn't understand.
- **Custom destination:** Choose the exact location in your vault where you want your notes to be saved. You can even choose different destinations for different projects.
- **Filename template:** Create a template for how you want your files to be titled
- **Append option:** Choose whether you want to create new files for each note or append to an existing file.
- **Original file:** Optionally save the original file (e.g., image/audio) to your vault’s attachments.
- **Multiple Projects**: Create separate flows for different kinds of notes, with individual instructions and save locations 
- **Email Upload**: Get a unique email address for each project where you can send handwritten notes and voice memos to be transcribed and stored 

## Installtion & Setup

### Requirements
- Obsidian v1.2.0 or newer.

### Install
You can install this plugin from from Obsidian Community Plugins. 

For manual installtion:
1. Download the latest release assets: `manifest.json`, `main.js` (and `styles.css` if present).
2. Place them in your vault at `.obsidian/plugins/flow-state-obsidian/`.
3. In Obsidian, enable the plugin (Settings → Community plugins).

### Connect your account
1. Open Settings → Community plugins → Flow State.
2. Enter your email and press Connect to receive a Magic Link. If you do not have a Flow State account, one will automatically be created for you.
3. Check your email and click the link to sign in (check your spam folder if you don't see it). 

### Create a project
Projects control where and how notes are saved. You can create multiple projects to handle different types of notes differently (separate transcription instructions, separate location to save them in, etc.)
- Destination: choose a vault folder or an existing file to append to.
- Title Template: use variables like `{{ai_generated_title}}`, `{{date_iso}}`, `{{time_iso}}`, and `{{original_filename}}`.
- AI Title Suggestion: optionally add an AI-generated title into your template.
- Instructions: tell the AI how to format or transform your notes.

### Share a note
There are many ways to send your notes to Flow State:
- Upload them through the [Flow State app](https://app.findflow.ai) (beta)
- Send an email to an address unique to your project.

### Sync your files 
After you send your note, Flow State will transcribe it using the guidelines and instructions you set. When the files are ready, this plugin will then automatically sync them into your vault.


## Privacy
- No analytics or tracking are included in this plugin.
- Only your Flow State outputs (and optionally original files) are written to your vault.
- Flow State does not view or store any other files from your vault.

## Troubleshooting
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
