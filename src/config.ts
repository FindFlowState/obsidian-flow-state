// Values are injected at build time by scripts/build.mjs via esbuild define()
 
declare const SUPABASE_URL: string;
 
declare const SUPABASE_ANON_KEY: string;
 
declare const INGEST_EMAIL_DOMAIN: string;
 
declare const ENV: string;

export const DEFAULT_SUPABASE_URL = (typeof SUPABASE_URL !== "undefined" ? SUPABASE_URL : "").trim();
export const DEFAULT_SUPABASE_ANON_KEY = (typeof SUPABASE_ANON_KEY !== "undefined" ? SUPABASE_ANON_KEY : "").trim();
export const DEFAULT_INGEST_EMAIL_DOMAIN = (typeof INGEST_EMAIL_DOMAIN !== "undefined" ? INGEST_EMAIL_DOMAIN : "").trim();
export const BUILD_ENV = (typeof ENV !== "undefined" ? ENV : "").trim();

/**
 * Accounts that get the dev-only surfaces (currently the "Onboarding (dev)"
 * command, which replays first-run onboarding). Compared case-insensitively
 * against the signed-in account's email. Not a security boundary — everything
 * behind it is local UI the user could reach by editing data.json anyway; it
 * just keeps a testing affordance out of normal users' command palettes.
 */
export const ADMIN_EMAILS = ["nhsheth@gmail.com", "rob@ungated.media"];

/** True when `email` belongs to an admin/dev account. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
}
