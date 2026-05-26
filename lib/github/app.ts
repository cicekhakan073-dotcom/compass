import "server-only";
import { App } from "octokit";

/**
 * GitHub App config. All three pieces are required for the App flow
 * (webhooks, install callback, PR comments). Without them the relevant
 * routes return 503 with a clear message — the rest of the app keeps
 * working.
 */
export interface AppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  /** GitHub App "slug" — used to build the install URL. */
  slug: string | null;
}

let cachedApp: App | null = null;

/**
 * Read App env vars and decode the private key. Supports two formats:
 *   - Raw PEM with real newlines (when set via vercel env add)
 *   - PEM with `\n` literals (when set via .env.local single line)
 */
export function readAppConfig(): AppConfig | null {
  const appId = process.env.GITHUB_APP_ID;
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!appId || !rawKey || !webhookSecret) return null;
  const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
  return {
    appId,
    privateKey,
    webhookSecret,
    slug: process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? null,
  };
}

export function githubAppConfigured(): boolean {
  return readAppConfig() !== null;
}

/**
 * Build (or return cached) Octokit App instance. The App object can mint
 * per-installation Octokits via `getInstallationOctokit(id)` and is the
 * canonical handle for App-scoped GitHub calls.
 */
export function getApp(): App {
  if (cachedApp) return cachedApp;
  const config = readAppConfig();
  if (!config) {
    throw new Error(
      "GitHub App env not set (GITHUB_APP_ID / PRIVATE_KEY / WEBHOOK_SECRET).",
    );
  }
  cachedApp = new App({
    appId: config.appId,
    privateKey: config.privateKey,
    webhooks: { secret: config.webhookSecret },
  });
  return cachedApp;
}

/** Public install URL — null when the slug isn't configured yet. */
export function appInstallUrl(): string | null {
  const config = readAppConfig();
  if (!config?.slug) return null;
  return `https://github.com/apps/${config.slug}/installations/new`;
}
