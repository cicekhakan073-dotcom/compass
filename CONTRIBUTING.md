# Contributing to compass

Thanks for considering a contribution. compass is built incrementally —
14 self-contained prompts each ship a working slice of the app — so the
codebase is meant to read top-to-bottom.

## Quick start

```bash
git clone https://github.com/cicekhakan073-dotcom/compass.git
cd compass
npm install
cp .env.example .env.local        # fill what you have
npm run db:migrate                # apply schema to your Neon DB
npm run dev                       # http://localhost:3000
```

You need *at minimum*:

- `DATABASE_URL` (Neon, free tier) — `vercel link && vercel env pull` does this for you
- `AUTH_SECRET` — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

Everything else degrades gracefully when missing (chat returns 400, OG image
still renders, ingest does the walk + parse without embeddings/summary).

## Project layout

```
app/                          App Router routes
  api/                        Server-only endpoints (chat, search, ingest, github)
  r/[owner]/[name]/           Repo page + dynamic OG image
  discover/                   Public repo grid
  settings/install/           GitHub App management
agents/                       AI agent definitions
  repo-guide.ts               Sonnet 4.6 / Opus 4.7 chat agent with 6 tools
  tour-director.ts            Opus 4.7 tour planner (structured Zod output)
  pr-reviewer.ts              Sonnet 4.6 PR diff summary for GitHub App
components/
  viewer/                     3-pane workspace (FileTree, CodeViewer, RepoViewer, TourPanel)
  Chat.tsx                    useChat hook + tool-call cards
  IngestProgress.tsx          Live polling progress bar
db/
  schema.ts                   Drizzle schema (15 tables)
  migrations/                 Generated SQL + journal
lib/
  alphatab/                   (unused — historic from another project)
  embeddings/embed.ts         text-embedding-3-small + batched
  github/                     App auth + webhook + REST helpers
  ingest/                     walker + parser + orchestrator (tree-sitter)
  search/semantic.ts          pgvector cosine top-k
  stores/                     Zustand stores (player + viewer)
  summary/architect.ts        Sonnet 4.6 architecture summary
  rate-limit.ts               Upstash sliding window
```

## Common workflows

### Adding a tool to the chat agent

1. Add `tool({ description, inputSchema, execute })` to the `buildTools()`
   return object in `agents/repo-guide.ts`.
2. Add an icon to `TOOL_ICONS` in `components/Chat.tsx`.
3. Add a friendly chip text to `describeInput()` in the same file.
4. Mention the tool by name in the agent's system prompt so it knows when
   to reach for it.

### Adding a column to an existing table

1. Edit `db/schema.ts`.
2. `npm run db:generate` — produces a new migration SQL file.
3. Inspect `db/migrations/000X_*.sql` for sanity.
4. `npm run db:migrate` to apply.
5. Update any callers (TypeScript will yell at you).

### Running tree-sitter parser locally

`lib/ingest/parser.ts` resolves wasm files via
`process.cwd()/node_modules/web-tree-sitter/tree-sitter.wasm` — works both
in `npm run dev` and on Vercel via `next.config.ts.outputFileTracingIncludes`.

If you upgrade `web-tree-sitter` past 0.24, grammars from
`tree-sitter-wasms@0.1.x` break (ABI mismatch). Stay on 0.24 unless you
upgrade both together.

### Running a guided tour

You need `ANTHROPIC_API_KEY` set. Then:

```bash
curl -X POST http://localhost:3000/api/repos/1/tour \
  -H "Content-Type: application/json" \
  -d '{"focus": "build cache"}'
```

Returns a JSON `plan` with 5-7 steps. The UI walks through them on user
"Devam" clicks.

## Code style

- TypeScript strict, no `any` unless really really cornered.
- Comments explain *why*, never *what* — well-named functions handle the latter.
- Server-only modules import `"server-only"` as their first line to keep
  Drizzle / Octokit out of the client bundle.
- Database queries go through Drizzle — no raw SQL except for the wasm extension
  bootstrap in migrations and pgvector cosine ops.

## Testing

There's no automated suite yet (hackathon roots) — manual smoke tests are:

```bash
# Type check
npx tsc --noEmit

# Production build
npm run build

# Lint
npm run lint
```

If you add a feature that has clear inputs and outputs, please add a tiny
script under `scripts/` or a route handler test. Vitest + Playwright are
on the roadmap.

## Database migrations

We use **drizzle-kit** for generation + push. Migrations are append-only —
never edit a committed file under `db/migrations/`. If you need to undo,
write a new migration that performs the reverse.

For local resets:

```bash
# Nuke and re-apply
psql $DATABASE_URL -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npm run db:migrate
```

## Pull requests

1. Fork + branch (`feat/your-thing`, `fix/some-bug`).
2. Run `npx tsc --noEmit` and `npm run build`.
3. Reference the prompt number you're extending if applicable
   (e.g. "Extends Prompt 8 by adding cross-file rename detection").
4. Screenshots / GIFs for any UI change are very welcome.

That's it. Open a PR, we'll review.
