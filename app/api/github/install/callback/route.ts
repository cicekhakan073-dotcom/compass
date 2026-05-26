import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { installations, repos } from "@/db/schema";
import { fetchRepoMetadata } from "@/lib/github";
import {
  getApp,
  githubAppConfigured,
} from "@/lib/github/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GitHub redirects here after a user installs the App. We bootstrap the
 * installation row + queue every accessible repo for ingestion so the
 * webhook events that arrive next have something to attach to.
 *
 * The same work happens via the `installation` webhook too, but this path
 * gives the user immediate visual feedback on the /settings/install page.
 */
export async function GET(request: Request) {
  if (!githubAppConfigured()) {
    return NextResponse.json(
      { error: "GitHub App env yok." },
      { status: 503 },
    );
  }
  const url = new URL(request.url);
  const idParam = url.searchParams.get("installation_id");
  if (!idParam) {
    return NextResponse.json(
      { error: "Missing installation_id in callback." },
      { status: 400 },
    );
  }
  const ghInstallId = Number.parseInt(idParam, 10);
  if (!Number.isFinite(ghInstallId)) {
    return NextResponse.json(
      { error: "Invalid installation_id." },
      { status: 400 },
    );
  }

  const app = getApp();
  let inst;
  try {
    const res = await app.octokit.rest.apps.getInstallation({
      installation_id: ghInstallId,
    });
    inst = res.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `GitHub installation fetch failed: ${message}` },
      { status: 502 },
    );
  }

  const account = inst.account as { login?: string; type?: string } | null;
  const accountLogin = account?.login ?? "unknown";
  const accountType = account?.type ?? "User";

  // Upsert the installation row.
  let installationDbId: number;
  const existing = await db.query.installations.findFirst({
    where: eq(installations.githubInstallationId, ghInstallId),
  });
  if (existing) {
    installationDbId = existing.id;
    await db
      .update(installations)
      .set({
        accountLogin,
        accountType,
        repoSelection: inst.repository_selection ?? null,
        updatedAt: new Date(),
      })
      .where(eq(installations.id, existing.id));
  } else {
    const [created] = await db
      .insert(installations)
      .values({
        githubInstallationId: ghInstallId,
        accountLogin,
        accountType,
        repoSelection: inst.repository_selection ?? null,
      })
      .returning();
    installationDbId = created.id;
  }

  // Enumerate accessible repos via the installation token and queue them.
  let queued = 0;
  try {
    const installOctokit = await app.getInstallationOctokit(ghInstallId);
    const repoList = await installOctokit.paginate(
      installOctokit.rest.apps.listReposAccessibleToInstallation,
      { per_page: 100 },
    );
    for (const r of repoList) {
      const meta = await fetchRepoMetadata(
        installOctokit as never,
        r.owner.login,
        r.name,
      );
      const existingRepo = await db.query.repos.findFirst({
        where: (row, { and, eq: e }) =>
          and(e(row.owner, meta.owner), e(row.name, meta.name)),
      });
      if (existingRepo) {
        await db
          .update(repos)
          .set({
            installationId: installationDbId,
            defaultBranch: meta.defaultBranch,
            description: meta.description,
            isPrivate: meta.isPrivate,
            headSha: meta.headSha,
            status:
              existingRepo.headSha === meta.headSha
                ? existingRepo.status
                : "queued",
            updatedAt: new Date(),
          })
          .where(eq(repos.id, existingRepo.id));
      } else {
        await db.insert(repos).values({
          owner: meta.owner,
          name: meta.name,
          fullName: meta.fullName,
          defaultBranch: meta.defaultBranch,
          headSha: meta.headSha,
          description: meta.description,
          isPrivate: meta.isPrivate,
          status: "queued",
          installationId: installationDbId,
        });
      }
      queued += 1;
    }
  } catch (err) {
    console.warn("[install] repo enumeration failed:", err);
  }

  // Send the user back to the settings page with a success flag.
  return NextResponse.redirect(
    new URL(`/settings/install?installed=${ghInstallId}&queued=${queued}`, url.origin),
  );
}
