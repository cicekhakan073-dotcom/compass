CREATE TABLE "installations" (
	"id" serial PRIMARY KEY NOT NULL,
	"github_installation_id" integer NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"repo_selection" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installations_github_installation_id_unique" UNIQUE("github_installation_id")
);
--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "installation_id" integer;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repos_installation_idx" ON "repos" USING btree ("installation_id");