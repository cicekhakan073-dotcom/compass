import "server-only";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import type { RepoSummary } from "@/db/schema";

const MODEL = "claude-sonnet-4-6";

const SummarySchema = z.object({
  purpose: z
    .string()
    .describe(
      "Exactly one English sentence (≤25 words) describing what this repo does and for whom.",
    ),
  entryPoints: z
    .array(
      z.object({
        path: z.string().describe("Repo-relative file path"),
        why: z.string().describe("≤15 words — what happens if you start here"),
      }),
    )
    .max(5)
    .describe("Files a new contributor should open first, ordered."),
  topModules: z
    .array(
      z.object({
        name: z.string().describe("Conceptual module name (kebab-case)"),
        path: z.string().describe("Directory or representative file"),
        description: z.string().describe("≤20 words — module's responsibility"),
      }),
    )
    .max(7)
    .describe("Major architectural pieces — 4 to 7 items."),
  techStack: z
    .array(z.string())
    .max(12)
    .describe("Frameworks, languages, key libraries. Single words/short phrases."),
  gotchas: z
    .array(z.string())
    .max(5)
    .describe(
      "Non-obvious things a new contributor should know — version pins, performance traps, naming conventions.",
    ),
});

type SummaryRaw = z.infer<typeof SummarySchema>;

const MAX_TREE_LINES = 300;
const MAX_README_CHARS = 8_000;
const MAX_MANIFEST_CHARS = 3_000;

export interface ArchitectInput {
  fullName: string;
  description: string | null;
  defaultBranch: string;
  /** Repo-relative paths of all indexed files, sorted. */
  filePaths: string[];
}

/**
 * Pull README + key manifests from GitHub, then ask Claude Sonnet 4.6 to
 * produce a structured architecture summary. Errors propagate to the
 * ingestion orchestrator which decides whether to surface them in `last_error`.
 */
export async function generateRepoSummary(
  octokit: Octokit,
  input: ArchitectInput,
): Promise<RepoSummary> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY (veya AI_GATEWAY_API_KEY) .env.local'da tanımlı değil — özet üretimi atlandı.",
    );
  }

  const [owner, name] = input.fullName.split("/");
  const readme = await fetchReadme(octokit, owner, name);
  const manifests = await fetchManifests(octokit, owner, name);

  const treeBlock = formatFileTree(input.filePaths);

  const prompt = buildPrompt({
    fullName: input.fullName,
    description: input.description,
    defaultBranch: input.defaultBranch,
    treeBlock,
    readme,
    manifests,
  });

  const { object } = await generateObject<typeof SummarySchema>({
    model: anthropic(MODEL),
    schema: SummarySchema,
    system:
      "You're an expert open-source maintainer onboarding a new contributor. " +
      "Respond ONLY via the provided JSON schema — no preamble, no markdown.",
    prompt,
    temperature: 0.2,
    maxRetries: 1,
  });

  return finalize(object);
}

function finalize(obj: SummaryRaw): RepoSummary {
  return {
    purpose: obj.purpose.trim(),
    entryPoints: obj.entryPoints,
    topModules: obj.topModules,
    techStack: obj.techStack,
    gotchas: obj.gotchas,
    generatedBy: MODEL,
    generatedAt: new Date().toISOString(),
  };
}

interface PromptParts {
  fullName: string;
  description: string | null;
  defaultBranch: string;
  treeBlock: string;
  readme: string | null;
  manifests: Array<{ path: string; content: string }>;
}

function buildPrompt(p: PromptParts): string {
  const sections: string[] = [];
  sections.push(`# Repository\n${p.fullName} (default branch: ${p.defaultBranch})`);
  if (p.description) sections.push(`Short description (from GitHub):\n${p.description}`);
  sections.push(`# File tree (indexed files, truncated)\n${p.treeBlock}`);
  if (p.readme) sections.push(`# README\n${p.readme}`);
  if (p.manifests.length > 0) {
    sections.push(
      `# Manifests / config files\n${p.manifests
        .map((m) => `## ${m.path}\n\`\`\`\n${m.content}\n\`\`\``)
        .join("\n\n")}`,
    );
  }
  sections.push(
    [
      "# Task",
      "Produce the JSON object the schema requires. Rules:",
      "- `purpose`: one short English sentence; no marketing fluff.",
      "- `entryPoints`: 3-5 real paths from the tree above. Skip generated files.",
      "- `topModules`: 4-7 architectural pieces inferred from the directory layout.",
      "- `techStack`: only items strongly evidenced (manifest deps, file extensions, README).",
      "- `gotchas`: surprising things a careful reviewer would warn a new contributor about.",
    ].join("\n"),
  );
  return sections.join("\n\n");
}

function formatFileTree(paths: string[]): string {
  if (paths.length <= MAX_TREE_LINES) return paths.join("\n");
  // For huge file lists, sample evenly so directory diversity survives.
  const stride = Math.ceil(paths.length / MAX_TREE_LINES);
  const sampled: string[] = [];
  for (let i = 0; i < paths.length; i += stride) sampled.push(paths[i]);
  sampled.push(`… and ${paths.length - sampled.length} more files (sampled)`);
  return sampled.join("\n");
}

async function fetchReadme(
  octokit: Octokit,
  owner: string,
  name: string,
): Promise<string | null> {
  try {
    const res = await octokit.repos.getReadme({ owner, repo: name });
    const decoded =
      res.data.encoding === "base64"
        ? Buffer.from(res.data.content, "base64").toString("utf8")
        : res.data.content;
    return decoded.slice(0, MAX_README_CHARS);
  } catch {
    return null;
  }
}

const MANIFEST_PATHS = [
  "package.json",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "requirements.txt",
  "Gemfile",
  "composer.json",
];

async function fetchManifests(
  octokit: Octokit,
  owner: string,
  name: string,
): Promise<Array<{ path: string; content: string }>> {
  const results = await Promise.allSettled(
    MANIFEST_PATHS.map(async (path) => {
      const res = await octokit.repos.getContent({ owner, repo: name, path });
      if (Array.isArray(res.data) || res.data.type !== "file") return null;
      const content =
        "content" in res.data && typeof res.data.content === "string"
          ? Buffer.from(res.data.content, "base64").toString("utf8")
          : "";
      return { path, content: content.slice(0, MAX_MANIFEST_CHARS) };
    }),
  );
  return results
    .filter(
      (r): r is PromiseFulfilledResult<{ path: string; content: string }> =>
        r.status === "fulfilled" && r.value !== null,
    )
    .map((r) => r.value);
}
