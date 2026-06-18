// Values are injected at build time by scripts/build.mjs via esbuild define()
 
declare const SUPABASE_URL: string;
 
declare const SUPABASE_ANON_KEY: string;
 
declare const INGEST_EMAIL_DOMAIN: string;
 
declare const ENV: string;

export const DEFAULT_SUPABASE_URL = (typeof SUPABASE_URL !== "undefined" ? SUPABASE_URL : "").trim();
export const DEFAULT_SUPABASE_ANON_KEY = (typeof SUPABASE_ANON_KEY !== "undefined" ? SUPABASE_ANON_KEY : "").trim();
export const DEFAULT_INGEST_EMAIL_DOMAIN = (typeof INGEST_EMAIL_DOMAIN !== "undefined" ? INGEST_EMAIL_DOMAIN : "").trim();
export const BUILD_ENV = (typeof ENV !== "undefined" ? ENV : "").trim();
