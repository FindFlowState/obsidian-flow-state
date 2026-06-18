// Sentry error tracking for Flowstate Obsidian plugin
import * as Sentry from "@sentry/browser";
import { rewriteFramesIntegration } from "@sentry/browser";

// These are injected at build time
declare const SENTRY_DSN: string;
declare const SENTRY_RELEASE: string;
declare const ENV: string;

let initialized = false;

export function initSentry(): void {
  // Only initialize in prod builds and if DSN is provided
  if (initialized || ENV !== "prod" || !SENTRY_DSN) {
    return;
  }

  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      release: SENTRY_RELEASE,
      environment: ENV,
      // Disable PII collection
      sendDefaultPii: false,
      // Only capture errors, not performance
      tracesSampleRate: 0,
      // Rewrite frame filenames to match uploaded source maps
      integrations: [
        rewriteFramesIntegration({
          iteratee: (frame) => {
            // Map "plugin:flow-state" to "~/main.js" to match source maps
            if (frame.filename?.includes("plugin:flow-state") || frame.filename?.includes("flow-state")) {
              frame.filename = "~/main.js";
            }
            return frame;
          },
        }),
      ],
      // Filter out non-plugin errors
      beforeSend(event) {
        const frames =
          event.exception?.values?.flatMap(
            (ex) => ex.stacktrace?.frames ?? []
          ) ?? [];

        // Drop errors where any frame comes from a different Obsidian plugin.
        // Sentry's sentryWrapped wrapper (bundled in our main.js) appears in
        // call stacks for other plugins' errors, so checking for main.js alone
        // is not sufficient.
        const fromOtherPlugin = frames.some(
          (frame) =>
            frame.filename?.startsWith("plugin:") &&
            !frame.filename.includes("flow-state")
        );
        if (fromOtherPlugin) return null;

        // Accept only if at least one frame is from our plugin
        const fromOurPlugin = frames.some(
          (frame) =>
            frame.filename?.includes("flow-state") ||
            frame.filename?.includes("~/main.js") ||
            frame.module?.includes("flow-state")
        );
        return fromOurPlugin ? event : null;
      },
    });
    initialized = true;
  } catch (e) {
    // Silently fail - don't let Sentry initialization break the plugin
    console.warn("[Flowstate] Sentry initialization failed:", e);
  }
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;

  let msg: string;
  if (error instanceof Error) {
    msg = error.message;
  } else if (typeof error === "object" && error !== null) {
    const o = error as { message?: unknown; details?: unknown };
    msg = typeof o.message === "string" ? o.message
        : typeof o.details === "string" ? o.details
        : "Unknown error";
  } else {
    msg = String(error);
  }

  // Don't report expected offline/network errors
  if (
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError") ||
    msg.includes("fetch failed") ||
    msg.includes("Load failed")
  ) {
    return;
  }

  // Supabase throws plain objects, not Error instances — wrap them so Sentry
  // shows a meaningful title instead of "Object captured as exception with keys"
  const err = error instanceof Error ? error : new Error(msg);
  Sentry.captureException(err, { extra: context });
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = "info"): void {
  if (!initialized) return;
  Sentry.captureMessage(message, level);
}

// Re-export for direct access if needed
export { Sentry };
