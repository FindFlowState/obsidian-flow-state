// Helpers for building a Flow's ingest email address (handle.slug@domain).

/** Normalize a user handle the same way the backend does. */
export function normalizeHandle(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-");
}

/** Compose a Flow's ingest email, or null if any part is missing. */
export function computeFlowEmail(
  handle: string | null | undefined,
  slug: string | null | undefined,
  domain: string | null | undefined
): string | null {
  if (!handle || !slug || !domain) return null;
  return `${normalizeHandle(handle)}.${slug}@${domain}`;
}
