// Front matter ("note properties") helpers for Obsidian delivery.
//
// Per-Flow config lives in routes.destination_config.front_matter and is
// owned by this plugin: the mobile and web apps never write
// destination_config for Obsidian routes, so what the user sets here is
// what syncs use.

export interface FrontMatterProperty {
  key: string;
  value: unknown;
}

export interface FrontMatterConfig {
  enabled: boolean;
  properties: FrontMatterProperty[];
}

// The only dynamic tokens supported in property values (resolved at sync
// time from the job's capture timestamp — no AI involved).
export const FRONT_MATTER_TOKENS = ["{{date}}", "{{time}}"] as const;

// Keys that would mutate the object prototype when assigned onto the
// front matter record handed out by processFrontMatter.
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local calendar date as YYYY-MM-DD — the format Obsidian infers as a Date property. */
export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local wall-clock time as HH:MM (24h). */
export function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Extract the front matter config from a route's destination_config.
 * destination_config is a raw JSON column also carrying unrelated keys
 * (e.g. embed_original), and may hold anything — tolerate every malformed
 * shape by returning null or dropping the bad entry, never throwing.
 */
export function parseFrontMatterConfig(destinationConfig: unknown): FrontMatterConfig | null {
  if (!destinationConfig || typeof destinationConfig !== "object" || Array.isArray(destinationConfig)) return null;
  const fm = (destinationConfig as Record<string, unknown>).front_matter;
  if (!fm || typeof fm !== "object" || Array.isArray(fm)) return null;
  const rec = fm as Record<string, unknown>;
  const rawProps = Array.isArray(rec.properties) ? rec.properties : [];
  const properties: FrontMatterProperty[] = [];
  for (const p of rawProps) {
    if (!p || typeof p !== "object" || Array.isArray(p)) continue;
    const key = (p as Record<string, unknown>).key;
    if (typeof key !== "string") continue;
    const trimmed = key.trim();
    if (!trimmed || FORBIDDEN_KEYS.has(trimmed)) continue;
    properties.push({ key: trimmed, value: (p as Record<string, unknown>).value });
  }
  return { enabled: rec.enabled === true, properties };
}

function substituteTokens(s: string, capturedAt: Date): string {
  return s
    .replace(/\{\{\s*date\s*\}\}/g, formatDate(capturedAt))
    .replace(/\{\{\s*time\s*\}\}/g, formatTime(capturedAt));
}

// Coercion keeps Obsidian property types useful for Bases: "true"/"false"
// become checkboxes, plain numerals become numbers (leading zeros stay
// text), and commas make a list. Everything else stays text.
const NUMBER_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;

function resolveValue(value: unknown, capturedAt: Date): unknown {
  if (Array.isArray(value)) {
    return (value as unknown[]).map((v) => (typeof v === "string" ? substituteTokens(v, capturedAt).trim() : v));
  }
  if (typeof value !== "string") return value;
  const substituted = substituteTokens(value, capturedAt).trim();
  if (substituted.includes(",")) {
    return substituted
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (substituted === "true") return true;
  if (substituted === "false") return false;
  if (NUMBER_RE.test(substituted)) return Number(substituted);
  return substituted;
}

/**
 * Resolve the configured properties into the values to stamp on a note.
 * capturedAt is the job's capture timestamp (created_at). Returns an empty
 * record when the config is missing or disabled. Insertion order follows
 * the configured order; on duplicate keys the first entry wins.
 */
export function resolveFrontMatter(config: FrontMatterConfig | null, capturedAt: Date): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!config?.enabled) return out;
  for (const prop of config.properties) {
    if (Object.prototype.hasOwnProperty.call(out, prop.key)) continue;
    out[prop.key] = resolveValue(prop.value, capturedAt);
  }
  return out;
}

/** Display form of a stored property value for the editor UI (lists show comma-separated). */
export function frontMatterValueToText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return (value as unknown[]).map((v) => frontMatterValueToText(v)).join(", ");
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return JSON.stringify(value) ?? "";
}

/**
 * YAML-ish rendering of resolved properties for the editor's live preview
 * only — actual note writes go through Obsidian's processFrontMatter, which
 * does real YAML serialization.
 */
export function renderFrontMatterPreview(resolved: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(resolved)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value as unknown[]) lines.push(`  - ${frontMatterValueToText(item)}`);
    } else {
      lines.push(`${key}: ${frontMatterValueToText(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}
