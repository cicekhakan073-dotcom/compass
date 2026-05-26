import "server-only";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { Octokit } from "@octokit/rest";

const MODEL = "claude-sonnet-4-6";

/** Cap on diff bytes we send to the model — keeps runs cheap + within window. */
const MAX_DIFF_CHARS = 24_000;

export interface PrSummary {
  text: string;
  /** Model that produced the summary. */
  generatedBy: string;
}

export interface PrSummaryContext {
  fullName: string;
  prNumber: number;
  prTitle: string;
  baseBranch: string;
  headBranch: string;
  changedFiles: number;
  additions: number;
  deletions: number;
}

/**
 * Pull the unified diff for `prNumber` and ask Sonnet 4.6 to produce a
 * three-sentence reviewer-style summary. Returns null if Anthropic isn't
 * configured so the webhook can post a "compass scanned" comment without
 * the summary blurb.
 */
export async function summarizePullRequest(
  octokit: Octokit,
  ctx: PrSummaryContext,
): Promise<PrSummary | null> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.AI_GATEWAY_API_KEY) {
    return null;
  }

  const [owner, repo] = ctx.fullName.split("/");
  let diff: string;
  try {
    const res = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      owner,
      repo,
      pull_number: ctx.prNumber,
      mediaType: { format: "diff" },
    });
    diff = (res.data as unknown as string) ?? "";
  } catch (err) {
    console.warn("[pr-reviewer] diff fetch failed:", err);
    return null;
  }

  const truncated = diff.length > MAX_DIFF_CHARS;
  const trimmedDiff = truncated
    ? diff.slice(0, MAX_DIFF_CHARS) + "\n[... diff truncated ...]"
    : diff;

  const { text } = await generateText({
    model: anthropic(MODEL),
    system:
      "You are a terse code reviewer. Read the unified diff and write " +
      "EXACTLY 2-3 sentences (≤320 chars total) describing what the PR " +
      "does and one notable risk or smell, if any. No bullet points, no " +
      "markdown headings, no 'this PR'. Plain prose only.",
    prompt: [
      `PR: ${ctx.fullName}#${ctx.prNumber} — ${ctx.prTitle}`,
      `Branches: ${ctx.headBranch} → ${ctx.baseBranch}`,
      `Scope: ${ctx.changedFiles} files, +${ctx.additions}/-${ctx.deletions}${
        truncated ? " (diff truncated)" : ""
      }`,
      "",
      "Unified diff:",
      trimmedDiff,
    ].join("\n"),
    temperature: 0.2,
    maxOutputTokens: 220,
  });

  return { text: text.trim(), generatedBy: MODEL };
}
