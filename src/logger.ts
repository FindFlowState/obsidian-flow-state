import { BUILD_ENV } from "./config";

const prefix = "[Flowstate]";
const enableInfo = BUILD_ENV === "local"; // only log info in local dev

export function log(...args: unknown[]) {
  // eslint-disable-next-line obsidianmd/rule-custom-message -- centralized logger; dev-only output gated by enableInfo
  if (enableInfo) console.log(prefix, ...args);
}
export function warn(...args: unknown[]) {
  console.warn(prefix, ...args);
}
export function error(...args: unknown[]) {
  console.error(prefix, ...args);
}

/** Best-effort human-readable message from an unknown thrown value. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
    try {
      return JSON.stringify(e);
    } catch {
      return "Unknown error";
    }
  }
  return String(e);
}
