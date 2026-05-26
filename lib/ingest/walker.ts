import "server-only";
import type { Octokit } from "@octokit/rest";
import { detectLanguage, LANGUAGES, type LangId, type LangSpec } from "./languages";

export interface WalkedFile {
  path: string;
  sha: string;
  size: number;
  lang: LangSpec;
}

/** Globs / substrings we skip outright. Cheap to evaluate. */
const SKIP_DIRS = [
  "node_modules/",
  ".git/",
  ".next/",
  "dist/",
  "build/",
  "out/",
  "target/",
  "venv/",
  ".venv/",
  "__pycache__/",
  "vendor/",
  ".pnpm-store/",
  "coverage/",
];

const SKIP_FILE_SUFFIXES = [
  ".min.js",
  ".min.css",
  ".map",
  ".lock",
  "-lock.json",
  ".snap",
  ".pyc",
  ".d.ts",
];

const SKIP_FILENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "uv.lock",
  "composer.lock",
]);

const MAX_FILE_BYTES = 200_000;

const LANG_PRIORITY: Record<LangId, number> = Object.fromEntries(
  LANGUAGES.map((l, i) => [l.id, i]),
) as Record<LangId, number>;

export interface WalkResult {
  files: WalkedFile[];
  totalCandidates: number;
  skipped: { binary: number; tooLarge: number; unsupported: number };
}

/**
 * Walk a repo's HEAD tree via the Git Trees API and produce a prioritized
 * list of files we want to index. Caps the result at `limit` files so
 * downstream blob fetches stay within the ingest function budget.
 *
 * Priority: supported language order (LANGUAGES list) → smaller file size.
 */
export async function walkRepoFiles(
  octokit: Octokit,
  owner: string,
  name: string,
  treeSha: string,
  limit = 100,
): Promise<WalkResult> {
  const res = await octokit.git.getTree({
    owner,
    repo: name,
    tree_sha: treeSha,
    recursive: "true",
  });

  const tree = res.data.tree ?? [];
  // GitHub silently truncates trees over 100k entries.
  if (res.data.truncated) {
    console.warn(
      `[walker] ${owner}/${name} tree truncated by GitHub — only first ${tree.length} entries seen`,
    );
  }

  const skipped = { binary: 0, tooLarge: 0, unsupported: 0 };
  const candidates: WalkedFile[] = [];

  for (const entry of tree) {
    if (entry.type !== "blob" || !entry.path || !entry.sha) continue;
    const path = entry.path;
    if (isSkippedPath(path)) {
      skipped.binary += 1;
      continue;
    }
    const size = entry.size ?? 0;
    if (size > MAX_FILE_BYTES) {
      skipped.tooLarge += 1;
      continue;
    }
    const lang = detectLanguage(path);
    if (!lang) {
      skipped.unsupported += 1;
      continue;
    }
    candidates.push({ path, sha: entry.sha, size, lang });
  }

  // Stable priority sort: lang index asc, then size asc (smaller files first
  // so we get broader coverage instead of one huge file eating the budget).
  candidates.sort((a, b) => {
    const pa = LANG_PRIORITY[a.lang.id];
    const pb = LANG_PRIORITY[b.lang.id];
    if (pa !== pb) return pa - pb;
    return a.size - b.size;
  });

  return {
    files: candidates.slice(0, limit),
    totalCandidates: candidates.length,
    skipped,
  };
}

function isSkippedPath(path: string): boolean {
  for (const dir of SKIP_DIRS) {
    if (path.startsWith(dir) || path.includes(`/${dir}`)) return true;
  }
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  if (SKIP_FILENAMES.has(base)) return true;
  for (const suffix of SKIP_FILE_SUFFIXES) {
    if (path.endsWith(suffix)) return true;
  }
  return false;
}
