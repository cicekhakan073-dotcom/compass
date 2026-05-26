import "server-only";
import { Octokit } from "@octokit/rest";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { accounts } from "@/db/schema";

/**
 * Build an Octokit client. Priority:
 *   1. Signed-in user's GitHub OAuth access_token (private repo access)
 *   2. Platform GH_TOKEN env (server-side fallback — 5000 req/h, public only)
 *   3. Unauthenticated (60 req/h per IP — last resort)
 *
 * GH_TOKEN is meant for production worker reliability when guests trigger
 * ingestion on public repos. Locally, set it from `gh auth token`.
 */
export async function getOctokit(): Promise<Octokit> {
  const session = await auth();
  if (session?.user?.id) {
    const acct = await db.query.accounts.findFirst({
      where: and(
        eq(accounts.userId, session.user.id),
        eq(accounts.provider, "github"),
      ),
    });
    if (acct?.access_token) {
      return new Octokit({
        auth: acct.access_token,
        userAgent: "compass",
      });
    }
  }
  if (process.env.GH_TOKEN) {
    return new Octokit({ auth: process.env.GH_TOKEN, userAgent: "compass" });
  }
  return new Octokit({ userAgent: "compass-dev" });
}

export interface RepoMetadata {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  headSha: string;
  description: string | null;
  isPrivate: boolean;
}

/**
 * Read minimal repo metadata GitHub gives us in two calls. Throws with a
 * caller-friendly message on 404 / 403 so the API route can surface it.
 */
export async function fetchRepoMetadata(
  octokit: Octokit,
  owner: string,
  name: string,
): Promise<RepoMetadata> {
  let repo;
  try {
    const res = await octokit.repos.get({ owner, repo: name });
    repo = res.data;
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 404) {
      throw new Error(
        `Repo bulunamadı: ${owner}/${name}. Özel ise giriş yapman gerekiyor.`,
      );
    }
    if (status === 403) {
      throw new Error(
        "GitHub API rate limit'ine takıldık. Giriş yapınca limit 5000/saate çıkar.",
      );
    }
    throw err;
  }

  // Get the head commit sha for the default branch — we'll re-ingest if
  // this changes, so we need an immutable anchor per ingestion run.
  const branch = await octokit.repos.getBranch({
    owner,
    repo: name,
    branch: repo.default_branch,
  });

  return {
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
    headSha: branch.data.commit.sha,
    description: repo.description ?? null,
    isPrivate: repo.private,
  };
}
