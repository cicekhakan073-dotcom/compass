# 🧭 compass

> **Onboarding'i 30 saniyeye indir.** Bir GitHub repo URL'si yapıştır, AI
> seninle gezerek o codebase'i tanıtsın — dosya ağacında otomatik gezinir,
> ilgili satırları highlight'lar, "neden burası böyle?" sorularına commit
> history + symbol graph'tan cevap verir.

[![Live demo](https://img.shields.io/badge/demo-compass--rust.vercel.app-00d9ff?style=flat-square)](https://compass-rust.vercel.app)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000?style=flat-square)](https://nextjs.org)
[![Claude Sonnet 4.6 + Opus 4.7](https://img.shields.io/badge/Claude-Sonnet_4.6_+_Opus_4.7-cc785c?style=flat-square)](https://anthropic.com)
[![License: MIT](https://img.shields.io/badge/license-MIT-9c40ff?style=flat-square)](#lisans)

> 📸 Demo GIF: `docs/demo.gif` (replace this line with a recording of paste-URL → 30s ingest → guided tour). Use [`asciinema`](https://asciinema.org) for terminal recordings or QuickTime for browser.

## Try it on famous repos

Tek tıkla canlı bir tur deneyimi:

| Repo | Link |
|---|---|
| **Next.js** | [compass-rust.vercel.app/r/vercel/next.js](https://compass-rust.vercel.app/r/vercel/next.js) |
| **React** | [compass-rust.vercel.app/r/facebook/react](https://compass-rust.vercel.app/r/facebook/react) |
| **FastAPI** | [compass-rust.vercel.app/r/tiangolo/fastapi](https://compass-rust.vercel.app/r/tiangolo/fastapi) |
| **Whisper** | [compass-rust.vercel.app/r/openai/whisper](https://compass-rust.vercel.app/r/openai/whisper) |
| **Turborepo** | [compass-rust.vercel.app/r/vercel/turborepo](https://compass-rust.vercel.app/r/vercel/turborepo) |

İlk ziyarette repo henüz indekslenmemişse landing'den göndererek tetikleyebilirsin.

## Neden compass

Yeni bir kod tabanına başlamak yavaş bir süreç: README, dosya gezme,
dağınık tarayıcı sekmeleri. **compass** bu adımı bir AI agent'a
devrediyor — agent kodu indeksler, sembol grafiğini çıkarır, sonra
soru-cevap yöntemiyle sana rehberlik eder.

Klasik bir "AI chat over your code" değil: agent doğrudan **kullanıcı
arayüzünü sürer** — dosyayı açar, ilgili satırları highlight'lar,
referans grafiğinde gezinir. Sen sadece soru sorar veya "Devam"
dersin.

## How it works

```
                    ┌──────────────────────────┐
   1. paste URL ─►  │  /api/repos/ingest       │  POST: parse + GitHub meta
                    └────────────┬─────────────┘
                                 │
                                 ▼
                    ┌──────────────────────────┐
   2. background    │  /api/repos/[id]/ingest  │  walker → 120 file cap
                    │  (Node serverless, 60s)  │  tree-sitter AST chunks
                    └────────────┬─────────────┘
                                 │
       ┌─────────────────────────┼─────────────────────────┐
       ▼                         ▼                         ▼
  pgvector              symbol_definitions          Claude Sonnet 4.6
  embeddings            symbol_references           summary (purpose,
  (1536d cosine HNSW)   (whoCalls/whatDoes…)        modules, gotchas)
       │                         │                         │
       └─────────────────────────┼─────────────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────┐
   3. chat ─► │  /api/chat  (Sonnet 4.6 ↔ Opus 4.7) │  routed by query
              │  6 tools:                            │  complexity
              │   searchCode · openFile · findRefs   │  (kw + length)
              │   whoCalls · whatDoesThisCall ·      │
              │   moduleOverview                     │
              └────────────────┬─────────────────────┘
                               │ tool calls publish to viewerStore (Zustand)
                               ▼
                ┌────────────────────────────────┐
   4. UI ────► │  RepoViewer (3-pane)           │
                │  ├─ FileTree (collapsible)    │
                │  ├─ CodeViewer (Monaco)        │
                │  └─ Chat / TourPanel           │
                └────────────────────────────────┘
                               │
                               ▼
       ┌───────────────────────────────────────────┐
   5. │  Tour mode: Opus 4.7 plans 5-7 steps,     │
       │  agent auto-drives the viewer; user      │
       │  clicks "Devam" to advance or types in   │
       │  chat to pause and ask a side question.  │
       └───────────────────────────────────────────┘
```

**GitHub App** (Prompt 11) closes the loop in the other direction: install
compass on a repo, every new PR gets an automated 2-3 sentence diff summary
+ deep-link back into the chat.

## Tech stack

| Katman | Seçim | Not |
|---|---|---|
| Framework | **Next.js 16** (App Router) | RSC, Turbopack |
| Dil | **TypeScript** strict | |
| UI | **Tailwind v4** + **shadcn/ui** | Koyu tema, cyan accent (`#00d9ff`) |
| Editor | **Monaco** (`@monaco-editor/react`) | read-only, AI line decorations |
| AI SDK | **Vercel AI SDK v5** | `streamText` + `generateObject` + `useChat` |
| Modeller | **Claude Sonnet 4.6** + **Opus 4.7** | escalation by keyword/length |
| Embeddings | OpenAI **text-embedding-3-small** | 1536d, cosine HNSW |
| AST | **tree-sitter** (TS/JS/Python/Go/Rust) | wasm via `web-tree-sitter@0.24` |
| DB | **Neon Postgres** + **pgvector** | 13 tables |
| ORM | **Drizzle** | type-safe + migrations |
| Auth | **Auth.js v5** + GitHub OAuth | `repo` scope |
| GitHub | **Octokit** + GitHub App + webhook | HMAC verify, PR comments |
| State | **Zustand** | viewer + tour state |
| Rate limit | **Upstash Redis** (sliding window) | 30/min chat, 10/h ingest |
| Telemetry | Vercel Analytics + Speed Insights | |
| Deploy | **Vercel** | preview + production |

## Klasör yapısı

```
compass/
├── app/                          # App Router rotaları
│   ├── api/                      # /chat, /repos/*, /github/*
│   ├── r/[owner]/[name]/         # Repo page + dynamic OG image
│   ├── discover/                 # Public repo grid
│   ├── settings/install/         # GitHub App management
│   ├── signin/                   # Auth.js sign-in
│   ├── layout.tsx                # Navbar + Analytics + Speed Insights
│   ├── error.tsx / global-error.tsx / not-found.tsx / loading.tsx
│   └── page.tsx                  # Landing (hero + RepoUrlForm)
├── agents/                       # AI agent tanımları
│   ├── repo-guide.ts             # Sonnet/Opus chat with 6 tools
│   ├── tour-director.ts          # Opus tour planner (Zod schema)
│   └── pr-reviewer.ts            # Sonnet PR diff summary
├── components/
│   ├── viewer/                   # FileTree, CodeViewer, RepoViewer, TourPanel
│   ├── Chat.tsx                  # useChat + tool-call cards
│   ├── RepoSummaryCard.tsx
│   ├── RepoUrlForm.tsx
│   ├── IngestProgress.tsx        # Real-time chunks counter
│   ├── IngestButton.tsx
│   ├── Skeleton.tsx
│   └── ui/                       # shadcn primitives (button, input, sheet)
├── db/
│   ├── schema.ts                 # 13 tables (auth + app + symbol graph)
│   ├── index.ts                  # Neon HTTP + drizzle client
│   └── migrations/               # 7 SQL files + journal
├── lib/
│   ├── ingest/                   # walker + parser + orchestrator
│   ├── embeddings/embed.ts       # AI SDK embedMany wrapper
│   ├── search/semantic.ts        # pgvector cosine top-k
│   ├── summary/architect.ts      # Claude Sonnet 4.6 + Zod
│   ├── github/                   # App auth + webhook + REST helpers
│   ├── stores/viewerStore.ts     # Zustand viewer + tour state
│   ├── rate-limit.ts             # Upstash sliding window
│   └── ...
├── auth.ts + auth/handlers.ts    # NextAuth v5 config
├── next.config.ts                # outputFileTracingIncludes for tree-sitter wasm
├── drizzle.config.ts
├── vercel.json                   # per-route maxDuration
└── README.md / CONTRIBUTING.md
```

## Prompt dizisi (canlı durum)

- [x] **Prompt 1** — Proje iskeleti + landing
- [x] **Prompt 2** — GitHub OAuth + Auth.js v5
- [x] **Prompt 3** — Repo ingestion + schema (pgvector)
- [x] **Prompt 4** — tree-sitter parsing + chunking
- [x] **Prompt 5** — Embeddings + semantic search
- [x] **Prompt 6** — Architecture summary (Claude Sonnet 4.6)
- [x] **Prompt 7** — Streaming chat + repo-guide agent
- [x] **Prompt 8** — Symbol graph + 3 yeni tool + Opus escalation
- [x] **Prompt 9** — Code viewer pane (Monaco + 3-panel)
- [x] **Prompt 10** — Tour mode (Opus 4.7 plan)
- [x] **Prompt 11** — GitHub App + webhook
- [x] **Prompt 12** — Public guides + paylaşım (OG)
- [x] **Prompt 13** — Polish (loading, errors, mobile, analytics, rate limit)
- [x] **Prompt 14** — Deploy + demo asset'leri (you are here)

## Geliştirme

```bash
git clone https://github.com/cicekhakan073-dotcom/compass.git
cd compass
npm install
vercel link --project compass     # opsiyonel
vercel env pull .env.local        # Neon + diğer Vercel env'leri çek
npm run db:migrate                # Drizzle migration'ları uygula
npm run dev                       # http://localhost:3000
```

Tam setup (Auth.js, OpenAI, Anthropic, GitHub App, Upstash) için bkz.
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Deployment

```bash
vercel deploy --prod --yes
```

Function `maxDuration` ayarları `vercel.json`'da. Production URL'i
deploy çıktısı verir; OG image'lar otomatik unfurl edilir.

## Demo akışı

1. Jüri "vercel/next.js" yapıştırır
2. ~30 sn: clone → AST chunks → embeddings → summary
3. AI: "Bu Next.js 16. Mimariye, app router'a veya build pipeline'a
   başlamak ister misin?"
4. Jüri "Turu başlat" tıklar → Opus 4.7 5-7 adımlı plan üretir
5. Her step'te viewer otomatik açılır, satırlar highlight'lanır,
   compass narrasyon yapar
6. Jüri arada "Turbopack burada nasıl entegre?" sorar → tour pause,
   Sonnet symbol graph'tan referansları takip eder, cevaplar
7. "Devam ettir" ile tur kaldığı yerden sürer

## Lisans

MIT
