CREATE TYPE "public"."symbol_kind" AS ENUM('function', 'method', 'class', 'interface', 'type', 'struct', 'trait', 'module', 'other');--> statement-breakpoint
CREATE TABLE "symbol_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_id" integer NOT NULL,
	"file_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" "symbol_kind" NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"start_byte" integer NOT NULL,
	"end_byte" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symbol_references" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_id" integer NOT NULL,
	"file_id" integer NOT NULL,
	"name" text NOT NULL,
	"line" integer NOT NULL,
	"byte_offset" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "symbol_definitions" ADD CONSTRAINT "symbol_definitions_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symbol_definitions" ADD CONSTRAINT "symbol_definitions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symbol_references" ADD CONSTRAINT "symbol_references_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symbol_references" ADD CONSTRAINT "symbol_references_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "symbol_defs_repo_name_idx" ON "symbol_definitions" USING btree ("repo_id","name");--> statement-breakpoint
CREATE INDEX "symbol_defs_file_idx" ON "symbol_definitions" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "symbol_refs_repo_name_idx" ON "symbol_references" USING btree ("repo_id","name");--> statement-breakpoint
CREATE INDEX "symbol_refs_file_idx" ON "symbol_references" USING btree ("file_id");