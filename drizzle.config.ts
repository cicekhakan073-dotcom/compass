import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Load .env.local first (vercel env pull writes here), then fall back to .env.
config({ path: ".env.local" });
config({ path: ".env" });

const url = process.env.DATABASE_URL;

if (!url) {
  console.warn(
    "[drizzle.config] DATABASE_URL not set — generate works, push/migrate will fail until set.",
  );
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: url ?? "postgresql://placeholder:placeholder@localhost/placeholder",
  },
  verbose: true,
  strict: true,
});
