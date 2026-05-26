import NextAuth, { type NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/db";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from "@/db/schema";

/**
 * GitHub OAuth scopes:
 *   - read:user      → profile name, email, avatar
 *   - public_repo    → reading public repos via Octokit (most popular path)
 *   - repo           → full access to private repos the user owns or collabs on
 *                       (needed for compass to ingest private codebases)
 *
 * The repo scope is broad — we ask for it up front so users don't get a
 * second consent screen when they paste a private repo URL. We never write.
 */
const providers: NextAuthConfig["providers"] = [];

if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      authorization: {
        params: { scope: "read:user user:email public_repo repo" },
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers,
  session: { strategy: "database" },
  pages: { signIn: "/signin" },
  trustHost: true,
});

/** True when GitHub OAuth credentials are configured. UI uses this to gate
 *  the sign-in button without breaking when secrets aren't set yet. */
export function githubConfigured() {
  return !!(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);
}
