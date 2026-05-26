import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { installations, repos } from "@/db/schema";
import {
  getApp,
  githubAppConfigured,
  readAppConfig,
} from "@/lib/github/app";
import {
  verifySignature,
  type InstallationPayload,
  type InstallationRepositoriesPayload,
  type PullRequestPayload,
} from "@/lib/github/webhook";
import { summarizePullRequest } from "@/agents/pr-reviewer";
import { fetchRepoMetadata } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Diff fetch + Sonnet 4.6 summary + comment post → ~10-20s on busy PRs.
export const maxDuration = 60;

/**
 * POST /api/github/webhook — public endpoint hit by GitHub for every event.
 *
 * Flow:
 *   1. Read raw body (HMAC needs unmodified bytes).
 *   2. Verify X-Hub-Signature-256 with WEBHOOK_SECRET; 401 on mismatch.
 *   3. Route by X-GitHub-Event header. Unhandled events 200 fast.
 *
 * Local dev: set up a smee.io channel and run
 *   npx smee-client --target http://localhost:3000/api/github/webhook
 * GitHub → smee → your laptop, no public tunnel required.
 */
export async function POST(request: Request) {
  if (!githubAppConfigured()) {
    return NextResponse.json(
      {
        error:
          "GitHub App env yok (GITHUB_APP_ID / PRIVATE_KEY / WEBHOOK_SECRET). /settings/install dokümana bak.",
      },
      { status: 503 },
    );
  }
  const config = readAppConfig()!;

  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifySignature(rawBody, signature, config.webhookSecret)) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }

  const event = request.headers.get("x-github-event") ?? "";
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  try {
    switch (event) {
      case "installation":
        await handleInstallation(payload as InstallationPayload);
        return NextResponse.json({ ok: true, event });

      case "installation_repositories":
        await handleInstallationRepositories(
          payload as InstallationRepositoriesPayload,
        );
        return NextResponse.json({ ok: true, event });

      case "pull_request": {
        const pr = payload as PullRequestPayload;
        if (pr.action !== "opened" && pr.action !== "synchronize" && pr.action !== "reopened") {
          return NextResponse.json({ ok: true, event, action: pr.action, skipped: true });
        }
        await handlePullRequest(pr);
        return NextResponse.json({ ok: true, event, action: pr.action });
      }

      default:
        return NextResponse.json({ ok: true, event, ignored: true });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[webhook] handler failed for ${event}:`, err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function handleInstallation(payload: InstallationPayload) {
  if (payload.action === "deleted") {
    // Soft-disconnect: drop the row, repos.installation_id auto-nulls.
    await db
      .delete(installations)
      .where(eq(installations.githubInstallationId, payload.installation.id));
    return;
  }
  if (payload.action !== "created" && payload.action !== "new_permissions_accepted") {
    return;
  }
  const installation = await upsertInstallation(payload);
  for (const repo of payload.repositories ?? []) {
    await linkRepo(repo, installation.id);
  }
}

async function handleInstallationRepositories(
  payload: InstallationRepositoriesPayload,
) {
  const installation = await upsertInstallation({
    action: "new_permissions_accepted",
    installation: {
      id: payload.installation.id,
      account: payload.installation.account,
      repository_selection: "selected",
    },
  });
  for (const repo of payload.repositories_added ?? []) {
    await linkRepo(repo, installation.id);
  }
  if (payload.repositories_removed?.length) {
    for (const removed of payload.repositories_removed) {
      const [owner, name] = removed.full_name.split("/");
      await db
        .update(repos)
        .set({ installationId: null, updatedAt: new Date() })
        .where(eq(repos.fullName, `${owner}/${name}`));
    }
  }
}

async function upsertInstallation(payload: InstallationPayload) {
  const existing = await db.query.installations.findFirst({
    where: eq(installations.githubInstallationId, payload.installation.id),
  });
  if (existing) {
    const [updated] = await db
      .update(installations)
      .set({
        accountLogin: payload.installation.account.login,
        accountType: payload.installation.account.type,
        repoSelection: payload.installation.repository_selection,
        updatedAt: new Date(),
      })
      .where(eq(installations.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(installations)
    .values({
      githubInstallationId: payload.installation.id,
      accountLogin: payload.installation.account.login,
      accountType: payload.installation.account.type,
      repoSelection: payload.installation.repository_selection,
    })
    .returning();
  return created;
}

/**
 * Ingest one repo into the catalog and link it to the installation that owns
 * it. We fetch real metadata (default branch, head_sha) via an installation
 * token so private repos work the same as public ones.
 */
async function linkRepo(
  ghRepo: { full_name: string; name: string },
  installationDbId: number,
) {
  const [owner, name] = ghRepo.full_name.split("/");
  const app = getApp();
  const installation = await db.query.installations.findFirst({
    where: eq(installations.id, installationDbId),
  });
  if (!installation) return;
  const installOctokit = await app.getInstallationOctokit(
    installation.githubInstallationId,
  );
  // Octokit App's installation octokit shares the same REST surface as the
  // user-scoped one we use elsewhere; cast for our shared metadata helper.
  const meta = await fetchRepoMetadata(installOctokit as never, owner, name);

  const existing = await db.query.repos.findFirst({
    where: (r, { and, eq: e }) => and(e(r.owner, owner), e(r.name, name)),
  });
  if (existing) {
    await db
      .update(repos)
      .set({
        installationId: installationDbId,
        defaultBranch: meta.defaultBranch,
        description: meta.description,
        isPrivate: meta.isPrivate,
        headSha: meta.headSha,
        // Re-queue only if the HEAD moved, so we don't thrash existing data.
        status: existing.headSha === meta.headSha ? existing.status : "queued",
        updatedAt: new Date(),
      })
      .where(eq(repos.id, existing.id));
    return;
  }
  await db.insert(repos).values({
    owner,
    name,
    fullName: meta.fullName,
    defaultBranch: meta.defaultBranch,
    headSha: meta.headSha,
    isPrivate: meta.isPrivate,
    description: meta.description,
    status: "queued",
    installationId: installationDbId,
  });
}

async function handlePullRequest(payload: PullRequestPayload) {
  if (!payload.installation) return;
  const installationGhId = payload.installation.id;
  const inst = await db.query.installations.findFirst({
    where: eq(installations.githubInstallationId, installationGhId),
  });
  if (!inst) {
    console.warn(
      "[webhook] PR event from unknown installation",
      installationGhId,
    );
    return;
  }

  // Confirm we still consider this repo linked. If the user added the App
  // to a repo we never recorded, link it on the fly.
  const repoRow = await db.query.repos.findFirst({
    where: eq(repos.fullName, payload.repository.full_name),
  });
  if (!repoRow) {
    await linkRepo(payload.repository, inst.id);
  }

  const app = getApp();
  const octokit = await app.getInstallationOctokit(installationGhId);
  const pr = payload.pull_request;
  const summary = await summarizePullRequest(octokit as never, {
    fullName: payload.repository.full_name,
    prNumber: pr.number,
    prTitle: pr.title,
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    changedFiles: pr.changed_files,
    additions: pr.additions,
    deletions: pr.deletions,
  });

  const compassUrl = `${appOrigin()}/r/${payload.repository.owner.login}/${payload.repository.name}?prNumber=${pr.number}`;
  const body = buildCommentBody({
    summary: summary?.text ?? null,
    model: summary?.generatedBy ?? null,
    compassUrl,
    pr,
  });

  await octokit.rest.issues.createComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issue_number: pr.number,
    body,
  });
}

function buildCommentBody(args: {
  summary: string | null;
  model: string | null;
  compassUrl: string;
  pr: PullRequestPayload["pull_request"];
}): string {
  const lines = [
    "🧭 **compass scanned this PR**",
    "",
  ];
  if (args.summary) {
    lines.push(`> ${args.summary}`);
    lines.push("");
  }
  lines.push(
    `**Scope:** ${args.pr.changed_files} files · +${args.pr.additions}/−${args.pr.deletions}`,
  );
  lines.push("");
  lines.push(`[**Ask compass about this PR →**](${args.compassUrl})`);
  lines.push("");
  lines.push(
    `<sub>compass · AI codebase guide${args.model ? ` · ${args.model}` : ""} · this comment is public and shareable</sub>`,
  );
  return lines.join("\n");
}

/**
 * Pick a public URL for the install. NEXT_PUBLIC_APP_URL wins (set this in
 * prod); otherwise fall back to a local-dev assumption.
 */
function appOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  return "http://localhost:3000";
}
