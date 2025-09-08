# Flow State Sync (Obsidian Plugin)

Sync Flow State jobs into your Obsidian vault via the Supabase SDK. Polls `jobs` where `status='transcribed'` for routes whose connection `service_type='obsidian'`, writes Markdown to your vault, optionally downloads the original file to the attachments folder, and acknowledges by updating `jobs.status='delivered'`.

## Features (v1)
- Jobs-based polling with single join query (`jobs -> routes -> connections`).
- Strict content check: errors if neither `formatted_content` nor `transcribed_text`.
- Atomic writes, conflict handling (overwrite/append/rename with rename default).
- Optional original-file download to attachments folder and embedded link.
- Background polling (desktop default 60s, mobile default 5m), Sync Now command.

## Install (dev)
1. Requirements: Node 20+.
2. From repo root:
   ```sh
   cd apps/obsidian_plugin
   npm install
   npm run build
   ```
3. Copy/symlink this folder into your Obsidian vault's `.obsidian/plugins/flow-state-obsidian` directory.
4. In Obsidian, enable the plugin.

## Local testing / E2E

For a full local pipeline (Supabase + Edge Functions + local Processor + optional Cloudflare Email Worker) and how to exercise sync with this plugin, see the [unified local testing guide](../../scripts/testing/README.md)

It covers starting services, running the E2E scripts in writing/audio modes, and how the plugin picks up `transcribed` jobs and writes them into your vault.

## Configure
- Open Settings → Community plugins → Flow State Sync.
- Set:
  - Supabase URL and anon key
  - Destination folder (vault-relative)
  - Filename template
  - Conflict strategy
  - Include original file (optional)

## How it Works
- Auth and DB:
  - Uses Supabase anon key with RLS enforced.
  - Polls with a single query joining `jobs` to `routes`→`connections` and filtering `service_type='obsidian'`.
- Content:
  - Markdown from `jobs.formatted_content` (fallback `transcribed_text`). If neither is present, the sync errors.
- Original file (optional):
  - Reads `jobs.metadata.original_object = { bucket, name }` (or parses `original_file_url`).
  - Downloads via `supabase.storage.from(bucket).download(name)` and writes the binary to the vault’s attachments folder.
- Acknowledgment:
  - After a successful write, updates the job row to `status='delivered'` and sets `destination_url` to an Obsidian deep link for the new file.

## Testing
- Unit tests (Vitest):
  ```sh
  npm test
  ```
- The unit tests cover templating utilities and strict content selection. Filesystem-dependent logic is kept minimal and uses Obsidian’s API at runtime.

## Dev Notes
- The build uses esbuild and marks `obsidian` as external.
- Background timers are conservative; mobile background execution is OS-limited.

## Release
- Bump version in `manifest.json` and `package.json`.
- Rebuild `main.js` and distribute the folder. Provide Supabase config values to testers.
