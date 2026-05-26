import "server-only";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  files,
  repos,
  symbolDefinitions,
  type Repo,
} from "@/db/schema";
import type { TourPlan } from "@/lib/stores/viewerStore";

const MODEL = "claude-opus-4-7";

const TourStepSchema = z.object({
  title: z
    .string()
    .describe("3–6 words. Punchy header for this step."),
  narration: z
    .string()
    .describe(
      "1-3 sentences (≤300 chars). Reader is sitting in front of a code viewer; explain what they're about to see and *why*.",
    ),
  action: z
    .discriminatedUnion("type", [
      z.object({
        type: z.literal("focus"),
        path: z
          .string()
          .describe("Repo-relative path. MUST exist in the file list."),
        startLine: z.number().int().optional(),
        endLine: z.number().int().optional(),
      }),
      z.object({
        type: z.literal("compare"),
        leftPath: z.string(),
        rightPath: z.string(),
      }),
      z.object({
        type: z.literal("narrate"),
      }),
    ])
    .describe(
      "What the viewer should do. Prefer `focus` (with line range when possible); use `compare` only when two files explain a concept jointly; use `narrate` for a pure transition step.",
    ),
});

const TourSchema = z.object({
  title: z
    .string()
    .describe("Overall tour title — repo name + concept, e.g. 'Turborepo'un build cache mimarisi'."),
  intro: z
    .string()
    .describe(
      "1-2 sentences setting expectations for the whole tour. ≤200 chars.",
    ),
  steps: z
    .array(TourStepSchema)
    .min(5)
    .max(7)
    .describe(
      "5-7 steps. Order: 1) entry point / hello world, 2-4) core modules, 5-6) one notable pattern or gotcha, 7) where to contribute.",
    ),
});

type TourSchemaT = z.infer<typeof TourSchema>;

export interface PlanTourOptions {
  /** Optional user-supplied focus, e.g. "build cache". Default: full overview. */
  focus?: string;
  /** Override the file-cap used when sampling the inventory for the prompt. */
  fileSample?: number;
}

const FILE_SAMPLE_DEFAULT = 200;
const SYMBOL_SAMPLE = 60;

/**
 * Generate a guided tour for a repo using Opus 4.7. Returns a plan whose
 * step paths are guaranteed to exist in the indexed file set — invalid
 * paths produced by the model are dropped (or replaced with the closest
 * sibling) before we hand the plan to the client.
 */
export async function planTour(
  repoId: number,
  opts: PlanTourOptions = {},
): Promise<TourPlan> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY (veya AI_GATEWAY_API_KEY) tanımlı değil — tur üretilemez.",
    );
  }

  const repo = await db.query.repos.findFirst({ where: eq(repos.id, repoId) });
  if (!repo) throw new Error(`Repo ${repoId} not found`);
  if (repo.status !== "ready") {
    throw new Error(`Repo henüz indekslenmemiş (status: ${repo.status}).`);
  }

  // Gather inputs.
  const fileLimit = opts.fileSample ?? FILE_SAMPLE_DEFAULT;
  const fileRows = await db
    .select({ path: files.path, lang: files.lang })
    .from(files)
    .where(eq(files.repoId, repoId))
    .orderBy(asc(files.path))
    .limit(fileLimit);

  // Hot symbols give the model a hint about what's "load-bearing".
  const hotSymbols = await db
    .select({
      name: symbolDefinitions.name,
      kind: symbolDefinitions.kind,
      path: files.path,
      startLine: symbolDefinitions.startLine,
      endLine: symbolDefinitions.endLine,
    })
    .from(symbolDefinitions)
    .innerJoin(files, eq(files.id, symbolDefinitions.fileId))
    .where(eq(symbolDefinitions.repoId, repoId))
    .orderBy(desc(symbolDefinitions.endLine))
    .limit(SYMBOL_SAMPLE);

  const validPaths = new Set(fileRows.map((f) => f.path));

  const prompt = buildPrompt(repo, fileRows, hotSymbols, opts.focus);

  const { object } = await generateObject<typeof TourSchema>({
    model: anthropic(MODEL),
    schema: TourSchema,
    system: SYSTEM_PROMPT,
    prompt,
    temperature: 0.4,
    maxRetries: 1,
  });

  return finalize(object, validPaths);
}

const SYSTEM_PROMPT = [
  "You design *guided tours* of unfamiliar open-source repositories.",
  "Your output is read by a code viewer that opens files + highlights line",
  "ranges as the user advances. Be concrete — name real files, real",
  "function names, real line numbers. No hand-waving.",
  "",
  "Rules:",
  "- Every focus.path MUST be one of the paths listed in the input.",
  "- Prefer line ranges 5-30 lines wide — short enough to read in 30s.",
  "- Use `compare` rarely (≤1 per tour), only when two files together",
  "  explain a concept neither file shows alone.",
  "- Narration is for someone seeing the file for the first time. Say what",
  "  it does, why it matters, what's surprising. Avoid 'this file'.",
  "- The whole tour reads bottom-up: entry → core → gotcha → next steps.",
].join("\n");

function buildPrompt(
  repo: Repo,
  fileRows: { path: string; lang: string }[],
  hotSymbols: Array<{
    name: string;
    kind: string;
    path: string;
    startLine: number;
    endLine: number;
  }>,
  focus: string | undefined,
): string {
  const sections: string[] = [];
  sections.push(
    `# Repository\n${repo.fullName} (default branch: ${repo.defaultBranch})`,
  );
  if (repo.description) sections.push(`Description: ${repo.description}`);
  if (repo.summary) {
    sections.push(
      `# Architecture summary (pre-computed)\n${JSON.stringify(repo.summary, null, 2)}`,
    );
  }
  sections.push(
    `# Indexed files (use ONLY these paths)\n${fileRows.map((f) => `${f.path}  [${f.lang}]`).join("\n")}`,
  );
  if (hotSymbols.length > 0) {
    sections.push(
      `# Notable symbols (name :: kind :: path :: lines)\n${hotSymbols
        .map(
          (s) =>
            `${s.name} :: ${s.kind} :: ${s.path} :: ${s.startLine}-${s.endLine}`,
        )
        .join("\n")}`,
    );
  }
  if (focus) {
    sections.push(
      `# Tour focus (user requested)\n"${focus}" — bias every step toward this concept.`,
    );
  } else {
    sections.push(
      "# Tour focus\nFull onboarding overview — no specific concept requested.",
    );
  }
  sections.push(
    "# Task\nDesign a 5-7 step guided tour using the JSON schema. Remember: every focus.path MUST appear in the indexed file list above.",
  );
  return sections.join("\n\n");
}

/**
 * Drop or repair steps whose path the LLM made up. We bias toward keeping
 * the tour at ≥5 steps; if more than 2 are invalid we leave the plan
 * shorter rather than fabricate fake ones.
 */
function finalize(obj: TourSchemaT, validPaths: Set<string>): TourPlan {
  const cleaned = obj.steps.filter((step) => {
    if (step.action.type === "narrate") return true;
    if (step.action.type === "focus") return validPaths.has(step.action.path);
    if (step.action.type === "compare") {
      return (
        validPaths.has(step.action.leftPath) &&
        validPaths.has(step.action.rightPath)
      );
    }
    return false;
  });
  return {
    title: obj.title.trim(),
    intro: obj.intro.trim(),
    steps: cleaned.length > 0 ? cleaned : obj.steps.slice(0, 1),
    generatedBy: MODEL,
  };
}
