import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";

// ─── Auth.js (NextAuth v5) tables ───────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (a) => [primaryKey({ columns: [a.provider, a.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationTokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (v) => [primaryKey({ columns: [v.identifier, v.token] })],
);

// ─── App: repos / files / embeddings ────────────────────────────────────────

export const repoStatus = pgEnum("repo_status", [
  "queued",
  "indexing",
  "ready",
  "failed",
]);

/**
 * One row per ingested GitHub repo. (owner, name) is the natural key but we
 * also keep `full_name = owner/name` denormalized for trivial display + search.
 * `head_sha` is the commit we indexed against — re-ingestion compares HEAD
 * and only re-runs files whose sha changed.
 */
export const repos = pgTable(
  "repos",
  {
    id: serial("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    headSha: text("head_sha"),
    status: repoStatus("status").default("queued").notNull(),
    /** GitHub's own short description, kept for cards / OG. */
    description: text("description"),
    /**
     * Mirrored from GitHub's `private` flag at ingest time. /discover hides
     * private repos; their /r/[o]/[n] pages 404 for non-owners.
     */
    isPrivate: boolean("is_private").default(false).notNull(),
    /** Number of files actually indexed (filled by Prompt 4 worker). */
    fileCount: integer("file_count").default(0).notNull(),
    /** Number of embedding rows (filled by Prompt 5 worker). */
    embeddingCount: integer("embedding_count").default(0).notNull(),
    /** Last error message when status='failed' — surfaced in UI. */
    lastError: text("last_error"),
    /**
     * Structured architecture summary produced by Prompt 6 (Claude Sonnet
     * 4.6). Shape is intentionally validated client-side rather than at
     * the column level so we can evolve fields without a migration.
     */
    summary: jsonb("summary").$type<RepoSummary | null>(),
    indexedAt: timestamp("indexed_at", { withTimezone: true }),
    requestedBy: text("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * GitHub App installation that owns this repo (Prompt 11). When set, the
     * webhook handler posts PR review comments via this installation's token.
     */
    installationId: integer("installation_id").references(() => installations.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("repos_owner_name_uniq").on(t.owner, t.name),
    index("repos_full_name_idx").on(t.fullName),
    index("repos_installation_idx").on(t.installationId),
  ],
);

/**
 * One row per GitHub App installation. A single install can cover many repos
 * (entire org or a curated list); we mirror just the metadata we need to
 * mint installation tokens and render the settings page.
 */
export const installations = pgTable("installations", {
  id: serial("id").primaryKey(),
  /** GitHub's own installation id — the integer the App APIs expect. */
  githubInstallationId: integer("github_installation_id").notNull().unique(),
  accountLogin: text("account_login").notNull(),
  accountType: text("account_type").notNull(),
  /** Snapshot of the repo selection at install time, for diagnostics. */
  repoSelection: text("repo_selection"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * One row per indexed file (binary, lock, and minified files are skipped at
 * walk time — Prompt 4). `content_hash` lets us detect "same path, new sha"
 * without diffing the blob.
 */
export const files = pgTable(
  "files",
  {
    id: serial("id").primaryKey(),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    sha: text("sha").notNull(),
    /** Tree-sitter language id ("typescript", "python", …). */
    lang: text("lang").notNull(),
    /** Bytes — kept for sorting / filtering big files in UI. */
    size: integer("size").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("files_repo_path_uniq").on(t.repoId, t.path)],
);

export const embeddingKind = pgEnum("embedding_kind", [
  "file_summary",
  "function",
  "class",
  "method",
  "import_block",
  "doc_block",
  "raw_chunk",
]);

/**
 * Semantic chunks ready for retrieval. `embedding` is a fixed 1536-dim vector
 * (matches OpenAI text-embedding-3-small) — pgvector handles cosine distance
 * via the ivfflat index added in the migration.
 */
export const embeddings = pgTable(
  "embeddings",
  {
    id: serial("id").primaryKey(),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    fileId: integer("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    kind: embeddingKind("kind").notNull(),
    symbolName: text("symbol_name"),
    /** Inclusive 1-based line range for jumping straight to a snippet. */
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("embeddings_file_chunk_uniq").on(t.fileId, t.chunkIndex),
    index("embeddings_repo_idx").on(t.repoId),
  ],
);

// ─── Symbol graph (Prompt 8) ────────────────────────────────────────────────

export const symbolKind = pgEnum("symbol_kind", [
  "function",
  "method",
  "class",
  "interface",
  "type",
  "struct",
  "trait",
  "module",
  "other",
]);

/**
 * One row per named definition the AST walker captures (function, class,
 * method, interface, type alias…). Byte offsets let us answer
 * "what references live inside this definition" in pure SQL without
 * re-parsing the file.
 */
export const symbolDefinitions = pgTable(
  "symbol_definitions",
  {
    id: serial("id").primaryKey(),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    fileId: integer("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: symbolKind("kind").notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    startByte: integer("start_byte").notNull(),
    endByte: integer("end_byte").notNull(),
  },
  (t) => [
    index("symbol_defs_repo_name_idx").on(t.repoId, t.name),
    index("symbol_defs_file_idx").on(t.fileId),
  ],
);

/**
 * One row per identifier-style occurrence in the source. Filtered by the
 * extractor to skip definitions' own name slots, keywords, and very short
 * identifiers (i, j, _, …). `byteOffset` makes containment queries cheap.
 */
export const symbolReferences = pgTable(
  "symbol_references",
  {
    id: serial("id").primaryKey(),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    fileId: integer("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    line: integer("line").notNull(),
    byteOffset: integer("byte_offset").notNull(),
  },
  (t) => [
    index("symbol_refs_repo_name_idx").on(t.repoId, t.name),
    index("symbol_refs_file_idx").on(t.fileId),
  ],
);

// ─── Chats + messages (Prompt 7) ────────────────────────────────────────────

/**
 * Conversation thread between a user and the repo-guide agent. One row per
 * "session"; we'll let users keep multiple chats per repo so they can park
 * an investigation and start a clean one.
 */
export const chats = pgTable(
  "chats",
  {
    id: serial("id").primaryKey(),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    /** Nullable so anonymous (cookie-less) sessions can also chat. */
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Auto-set to the first ~50 chars of the first user message. */
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("chats_repo_idx").on(t.repoId)],
);

export const messageRole = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
]);

/**
 * One row per turn. `content` is the plain-text concatenation (for cheap
 * display); `tool_calls` carries the structured AI SDK tool invocation
 * records so we can re-render the full collapsible cards on history reloads.
 */
export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    chatId: integer("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls").$type<ToolCallRecord[] | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("messages_chat_idx").on(t.chatId)],
);

// ─── Relations ──────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  repos: many(repos),
  chats: many(chats),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const reposRelations = relations(repos, ({ one, many }) => ({
  requester: one(users, {
    fields: [repos.requestedBy],
    references: [users.id],
  }),
  installation: one(installations, {
    fields: [repos.installationId],
    references: [installations.id],
  }),
  files: many(files),
  embeddings: many(embeddings),
}));

export const installationsRelations = relations(installations, ({ many }) => ({
  repos: many(repos),
}));

export const filesRelations = relations(files, ({ one, many }) => ({
  repo: one(repos, { fields: [files.repoId], references: [repos.id] }),
  embeddings: many(embeddings),
}));

export const embeddingsRelations = relations(embeddings, ({ one }) => ({
  repo: one(repos, { fields: [embeddings.repoId], references: [repos.id] }),
  file: one(files, { fields: [embeddings.fileId], references: [files.id] }),
}));

export const chatsRelations = relations(chats, ({ one, many }) => ({
  repo: one(repos, { fields: [chats.repoId], references: [repos.id] }),
  user: one(users, { fields: [chats.userId], references: [users.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  chat: one(chats, { fields: [messages.chatId], references: [chats.id] }),
}));

// ─── Inferred types ─────────────────────────────────────────────────────────

/** Shape of `repos.summary` — produced by Prompt 6's architect agent. */
export interface RepoSummary {
  purpose: string;
  entryPoints: Array<{ path: string; why: string }>;
  topModules: Array<{ name: string; path: string; description: string }>;
  techStack: string[];
  gotchas: string[];
  /** Model + ISO timestamp for cache invalidation / UI debug. */
  generatedBy: string;
  generatedAt: string;
}

/**
 * Persisted tool invocation record. We don't strongly type the input/output
 * shapes at the column level so individual tools can evolve without DB
 * migrations — the chat UI knows how to render each tool by name.
 */
export interface ToolCallRecord {
  toolName: string;
  input: unknown;
  output: unknown;
  state: "result" | "error";
  errorMessage?: string;
}

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Repo = typeof repos.$inferSelect;
export type NewRepo = typeof repos.$inferInsert;
export type File = typeof files.$inferSelect;
export type Embedding = typeof embeddings.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type SymbolDefinition = typeof symbolDefinitions.$inferSelect;
export type SymbolReference = typeof symbolReferences.$inferSelect;
export type Installation = typeof installations.$inferSelect;
export type NewInstallation = typeof installations.$inferInsert;
