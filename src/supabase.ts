import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Route, RouteInsert, RouteUpdate } from "@flowstate/supabase-types";
import type { App } from "obsidian";
import type { PluginSettings } from "./settings";
import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY } from "./config";
import { log, warn } from "./logger";

let client: SupabaseClient<Database> | null = null;

export function getSupabase(settings: PluginSettings): SupabaseClient<Database> {
  if (client) return client;
  const url = (settings.supabaseUrl || DEFAULT_SUPABASE_URL).trim();
  const key = (settings.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY).trim();
  // Log where we're pointing (mask key)
  const keyPrefix = key ? key.slice(0, 8) : "";
  log("supabase:init", { url, anonKeyPrefix: keyPrefix });
  client = createClient<Database>(url, key, {
    auth: {
      persistSession: true
    }
  });
  return client;
}

export async function sendMagicLink(
  supabase: SupabaseClient,
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

export async function exchangeCodeFromUrl(supabase: SupabaseClient, url: string) {
  // For obsidian:// callback URLs
  const { error } = await supabase.auth.exchangeCodeForSession(url);
  if (error) throw error;
}

// Convenience: accept Obsidian protocol params and construct the callback URL for Supabase SDK
export async function exchangeFromObsidianParams(
  supabase: SupabaseClient,
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

export async function getCurrentSession(supabase: SupabaseClient) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session ?? null;
}

export async function signOut(supabase: SupabaseClient) {
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
  const basePath = (app.vault as any)?.adapter?.getBasePath?.() ?? null;
  log("connection:ensure", { uid, vaultName, basePath });
  // Try to find an existing Obsidian connection; prefer one matching this vault name
  {
    const { data, error } = await supabase
      .from("connections")
      .select("id, service_type, account_name, metadata, created_at")
      .eq("service_type", "obsidian")
      .eq("user_id", uid)
      .order("created_at", { ascending: false });
    if (error) throw error;
    log("connection:list", { count: data?.length ?? 0 });
    // Prefer a strict match on vault base path when available; else fall back to vault name
    const matchByPath = basePath
      ? data?.find((c: any) => (c.metadata?.vault_base_path ?? null) === basePath)
      : null;
    const matchByVault = data?.find((c: any) => c.account_name === vaultName);
    const match = matchByPath?.id ?? matchByVault?.id ?? null;
    if (match) {
      log("connection:chosen", { connection_id: match, via: matchByPath ? "vault_base_path" : "vault_name" });
      return match as string;
    }
  }
  // Create a new connection for this vault/device
  const { data: inserted, error: insertErr } = await supabase
    .from("connections")
    .insert({
      user_id: uid,
      service_type: "obsidian",
      account_name: vaultName,
      // access_token is now required by schema; use a local sentinel token for Obsidian
      access_token: "local",
      metadata: { vault_name: vaultName, vault_base_path: basePath },
    })
    .select("id")
    .single();
  if (insertErr) throw insertErr;
  log("connection:created", { connection_id: inserted!.id });
  return inserted!.id as string;
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
  return (data as unknown) as Route[];
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
  return data as unknown as Route;
}

export async function createProject(
  supabase: SupabaseClient<Database>,
  app: App,
  params: {
    name: string;
    slug?: string;
    destination_location?: string | null;
    destination_config?: any;
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
  return data as unknown as Route;
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
  return data as unknown as Route;
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
    .select("subscription_credits, purchased_credits")
    .eq("id", uid)
    .single();

  if (error) throw error;
  return data as UserCredits;
}