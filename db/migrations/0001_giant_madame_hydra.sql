-- Enable pgvector before any vector(N) columns are created.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."embedding_kind" AS ENUM('file_summary', 'function', 'class', 'method', 'import_block', 'doc_block', 'raw_chunk');--> statement-breakpoint
CREATE TYPE "public"."repo_status" AS ENUM('queued', 'indexing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_id" integer NOT NULL,
	"file_id" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"kind" "embedding_kind" NOT NULL,
	"symbol_name" text,
	"start_line" integer,
	"end_line" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_id" integer NOT NULL,
	"path" text NOT NULL,
	"sha" text NOT NULL,
	"lang" text NOT NULL,
	"size" integer NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"head_sha" text,
	"status" "repo_status" DEFAULT 'queued' NOT NULL,
	"description" text,
	"file_count" integer DEFAULT 0 NOT NULL,
	"embedding_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"indexed_at" timestamp with time zone,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "embeddings_file_chunk_uniq" ON "embeddings" USING btree ("file_id","chunk_index");--> statement-breakpoint
CREATE INDEX "embeddings_repo_idx" ON "embeddings" USING btree ("repo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "files_repo_path_uniq" ON "files" USING btree ("repo_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "repos_owner_name_uniq" ON "repos" USING btree ("owner","name");--> statement-breakpoint
CREATE INDEX "repos_full_name_idx" ON "repos" USING btree ("full_name");
-- Cosine similarity index for retrieval (Prompt 5+).
CREATE INDEX IF NOT EXISTS embeddings_embedding_cosine_idx ON embeddings USING hnsw (embedding vector_cosine_ops);
