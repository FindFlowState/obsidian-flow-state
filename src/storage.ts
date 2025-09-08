import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@flowstate/supabase-types";

export async function downloadFromStorage(
  supabase: SupabaseClient<Database>,
  bucket: string,
  name: string
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(bucket).download(name);
  if (error) throw error;
  const buf = await data.arrayBuffer();
  return new Uint8Array(buf);
}