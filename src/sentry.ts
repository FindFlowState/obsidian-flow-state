// Sentry error tracking for Flow State Obsidian plugin
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
        // Only send errors that originate from our plugin
        const dominated = event.exception?.values?.some((ex) =>
          ex.stacktrace?.frames?.some((frame) =>
            frame.filename?.includes("flow-state") ||
            frame.filename?.includes("main.js") ||
            frame.module?.includes("flow-state")
          )
        );
        return dominated ? event : null;
      },
    });
    initialized = true;
    console.log("[Flow State] Sentry initialized");
  } catch (e) {
    // Silently fail - don't let Sentry initialization break the plugin
    console.warn("[Flow State] Sentry initialization failed:", e);
  }
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(error, { extra: context });
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = "info"): void {
  if (!initialized) return;
  Sentry.captureMessage(message, level);
}

// Re-export for direct access if needed
export { Sentry };
