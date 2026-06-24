import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Route, RouteInsert, RouteUpdate } from "./types";
import { FileSystemAdapter } from "obsidian";
import type { App } from "obsidian";
import type { PluginSettings } from "./settings";
import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY } from "./config";
import { log } from "./logger";

// Shape of the connections.metadata JSON we read/write for Obsidian connections.
type ConnectionMetadata = {
  pending?: boolean;
  vault_base_path?: string | null;
  vault_name?: string;
} | null;

let client: SupabaseClient<Database> | null = null;

/**
 * Supabase auth storage adapter — a structural subset of supabase-js's
 * `SupportedStorage` that we implement (get/set/remove, sync or async).
 */
export type AuthStorageAdapter = {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
};

/** Minimal slice of the plugin the data.json auth adapter needs. */
export interface AuthStorageHost {
  settings: { authStore?: Record<string, string> };
  saveData: (data: unknown) => Promise<void>;
}

/**
 * Auth storage adapter backed by the plugin's `data.json` (via
 * `settings.authStore` + `saveData`), so the Supabase session survives plugin
 * updates/reloads — Obsidian doesn't reliably persist `localStorage` across
 * updates, especially on mobile. On first read a key falls back to
 * `localStorage` and is migrated into `data.json`, so introducing this adapter
 * doesn't sign existing users out.
 */
export function createDataJsonAuthStorage(host: AuthStorageHost): AuthStorageAdapter {
  const store = (): Record<string, string> => (host.settings.authStore ??= {});
  return {
    getItem: (key) => {
      const current = store()[key];
      if (current != null) return current;
      // One-time migration: supabase-js previously wrote the session to the
      // renderer's window.localStorage. Read it once (App#loadLocalStorage can't
      // see it — different namespace) and migrate it into data.json.
      try {
        const legacy = typeof window !== "undefined" ? window.localStorage?.getItem(key) ?? null : null;
        if (legacy != null) {
          store()[key] = legacy;
          void host.saveData(host.settings);
          return legacy;
        }
      } catch {
        /* window.localStorage may be unavailable */
      }
      return null;
    },
    setItem: async (key, value) => {
      store()[key] = value;
      await host.saveData(host.settings);
    },
    removeItem: async (key) => {
      if (key in store()) {
        delete store()[key];
        await host.saveData(host.settings);
      }
    },
  };
}

export function getSupabase(
  settings: PluginSettings,
  storage?: AuthStorageAdapter
): SupabaseClient<Database> {
  if (client) return client;
  const url = (settings.supabaseUrl || DEFAULT_SUPABASE_URL).trim();
  const key = (settings.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY).trim();
  // Log where we're pointing (mask key)
  const keyPrefix = key ? key.slice(0, 8) : "";
  log("supabase:init", { url, anonKeyPrefix: keyPrefix, persistedAuth: !!storage });
  client = createClient<Database>(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      ...(storage ? { storage } : {}),
    },
  });
  return client;
}

export async function sendMagicLink(
  supabase: SupabaseClient<Database>,
  email: string,
  redirectTo: string
) {
  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo }
  });
  if (error) throw error;
  return data;
}

export async function exchangeCodeFromUrl(supabase: SupabaseClient<Database>, url: string) {
  // For obsidian:// callback URLs
  const { error } = await supabase.auth.exchangeCodeForSession(url);
  if (error) throw error;
}

// Convenience: accept Obsidian protocol params and construct the callback URL for Supabase SDK
export async function exchangeFromObsidianParams(
  supabase: SupabaseClient<Database>,
  params: Record<string, string>,
  redirectUri = "obsidian://flow-state"
) {
  // If hash contains access_token/refresh_token, set session directly (Magic Link)
  const hash = params["hash"] ?? "";
  if (hash.includes("access_token=") && hash.includes("refresh_token=")) {
    const sp = new URLSearchParams(hash);
    const access_token = sp.get("access_token") ?? "";
    const refresh_token = sp.get("refresh_token") ?? "";
    if (!access_token || !refresh_token) {
      throw new Error("Magic link missing tokens in hash");
    }
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    return;
  }

  // Otherwise, fall back to exchanging a code (e.g., OAuth PKCE)
  const qs = new URLSearchParams(params).toString();
  const url = qs ? `${redirectUri}?${qs}` : redirectUri;
  const { error } = await supabase.auth.exchangeCodeForSession(url);
  if (error) throw error;
}

// removed dev password sign-in

export async function getCurrentSession(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session ?? null;
}

export async function signOut(supabase: SupabaseClient<Database>) {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// -------- Projects helpers (server-backed) --------
export async function ensureObsidianConnection(
  supabase: SupabaseClient<Database>,
  app: App
): Promise<string> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const uid = userData.user?.id;
  if (!uid) throw new Error("Not signed in");
  const vaultName = app.vault.getName?.() ?? "Obsidian Vault";
  // Desktop Obsidian exposes a FileSystemAdapter with getBasePath(); use it to distinguish devices/vaults
  const basePath = app.vault.adapter instanceof FileSystemAdapter ? app.vault.adapter.getBasePath() : null;
  log("connection:ensure", { uid, vaultName, basePath });
  // Try to find an existing Obsidian connection; prefer one matching this vault name
  {
    const { data, error } = await supabase
      .from("connections")
      .select("id, service_type, account_name, metadata, created_at")
      .eq("service_type", "obsidian")
      .eq("user_id", uid)
      // Only consider live connections. A disconnected (is_active=false) connection
      // still carries this vault's vault_base_path/account_name, so without this
      // filter matchByPath/matchByVault would re-adopt a dead connection and skip
      // claiming the active pending one the user just created in the app.
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (error) throw error;
    log("connection:list", { count: data?.length ?? 0 });
    // A pending connection has only placeholder details (its account_name is the
    // generic "Obsidian Vault" and it has no vault_base_path), so it must never be
    // treated as an already-claimed match — otherwise it short-circuits the return
    // below and is never claimed. Exclude pending rows from the match candidates so
    // they always fall through to the claim branch.
    const claimable = data?.filter((c) => (c.metadata as ConnectionMetadata)?.pending !== true) ?? [];
    // Prefer a strict match on vault base path when available; else fall back to vault name
    const matchByPath = basePath
      ? claimable.find((c) => ((c.metadata as ConnectionMetadata)?.vault_base_path ?? null) === basePath)
      : null;
    const matchByVault = claimable.find((c) => c.account_name === vaultName);
    const match = matchByPath?.id ?? matchByVault?.id ?? null;
    if (match) {
      log("connection:chosen", { connection_id: match, via: matchByPath ? "vault_base_path" : "vault_name" });
      return match;
    }
    // No vault match — adopt ("claim") a pending connection the user created in the
    // app before installing the plugin. Pending connections carry metadata.pending
    // and no vault details yet; claiming fills them in and clears the pending flag.
    const pending = data?.find((c) => (c.metadata as ConnectionMetadata)?.pending === true);
    if (pending) {
      const { error: claimErr } = await supabase
        .from("connections")
        .update({
          account_name: vaultName,
          metadata: { vault_name: vaultName, vault_base_path: basePath },
        })
        .eq("id", pending.id);
      if (claimErr) throw claimErr;
      log("connection:claimed", { connection_id: pending.id });
      return pending.id;
    }
  }
  // Create a new connection for this vault/device
  const { data: inserted, error: insertErr } = await supabase
    .from("connections")
    .insert({
      user_id: uid,
      service_type: "obsidian",
      account_name: vaultName,
      metadata: { vault_name: vaultName, vault_base_path: basePath },
    })
    .select("id")
    .single();
  if (insertErr) throw insertErr;
  log("connection:created", { connection_id: inserted.id });
  return inserted.id;
}

export async function listObsidianRoutes(
  supabase: SupabaseClient<Database>
): Promise<Route[]> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const uid = userData.user?.id;
  if (!uid) throw new Error("Not signed in");
  log("routes:list:query", { uid });
  const { data, error } = await supabase
    .from("routes")
    .select(`*, connections!inner(service_type)`)
    .eq("user_id", uid)
    .eq("is_active", true)
    .eq("connections.service_type", "obsidian")
    .order("id", { ascending: true });
  if (error) throw error;
  log("routes:list:result", { count: data?.length ?? 0 });
  return data;
}

export async function fetchRouteById(
  supabase: SupabaseClient<Database>,
  routeId: string
): Promise<Route | null> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const uid = userData.user?.id;
  if (!uid) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("routes")
    .select()
    .eq("id", routeId)
    .eq("user_id", uid)
    .single();
  if (error) throw error;
  return data;
}

export async function createProject(
  supabase: SupabaseClient<Database>,
  app: App,
  params: {
    name: string;
    slug?: string;
    destination_location?: string | null;
    destination_config?: unknown;
    include_original_file?: boolean;
    append_to_existing?: boolean | null;
    custom_instructions?: string | null;
    use_ai_title?: boolean | null;
    ai_title_instructions?: string | null;
    is_active?: boolean | null;
  }
): Promise<Route> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const uid = userData.user?.id;
  if (!uid) throw new Error("Not signed in");
  // Do not set slug on create; let the backend generate a unique slug automatically
  const connection_id = await ensureObsidianConnection(supabase, app);
  // Build insert payload without introducing nulls for NOT NULL columns.
  const insertPayload: RouteInsert = {
    user_id: uid,
    name: params.name,
    // Optional columns: omit when not provided to let DB defaults apply
    destination_location: params.destination_location ?? undefined,
    destination_config: params.destination_config ?? undefined,
    include_original_file: params.include_original_file ?? undefined, // DB default true
    append_to_existing: params.append_to_existing ?? undefined, // DB default false
    custom_instructions: params.custom_instructions ?? undefined,
    use_ai_title: params.use_ai_title ?? true, // Always use AI-generated titles
    ai_title_instructions: params.ai_title_instructions ?? undefined,
    // Ensure active by default per schema NOT NULL DEFAULT true
    is_active: params.is_active ?? true,
    connection_id,
  } as unknown as RouteInsert; // allow undefined to omit keys in JSON
  const { data, error } = await supabase
    .from("routes")
    .insert(insertPayload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateRoute(
  supabase: SupabaseClient<Database>,
  routeId: string,
  patch: RouteUpdate
): Promise<Route> {
  const { data, error } = await supabase
    .from("routes")
    .update(patch)
    .eq("id", routeId)
    .select()
    .single();
  if (error) {
    const msg = String(error.message || error).toLowerCase();
    if (
      msg.includes("duplicate key value") ||
      msg.includes("unique constraint") ||
      msg.includes("routes_user_id_slug_key")
    ) {
      throw new Error("That email slug is already in use for your account. Please choose a different slug.");
    }
    throw error;
  }
  return data;
}

export async function deleteRoute(
  supabase: SupabaseClient<Database>,
  routeId: string
): Promise<void> {
  // Soft delete: set is_active to false instead of hard delete
  const { error } = await supabase
    .from("routes")
    .update({ is_active: false })
    .eq("id", routeId);
  if (error) throw error;
}

// -------- User credits helpers --------
export type UserCredits = {
  subscription_credits: number;
  purchased_credits: number;
  subscription_plan: string;
};

export async function fetchUserCredits(
  supabase: SupabaseClient<Database>
): Promise<UserCredits | null> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const uid = userData.user?.id;
  if (!uid) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("users")
    .select("subscription_credits, purchased_credits, subscription_plan")
    .eq("id", uid)
    .single();

  if (error) throw error;
  return data;
}