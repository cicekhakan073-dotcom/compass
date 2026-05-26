import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { Compass, Flame, GitBranch, Search, X } from "lucide-react";
import { db } from "@/db";
import { repos } from "@/db/schema";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Discover · compass",
  description:
    "İndekslenmiş public repository'lerin keşfedilebilir grid'i — AI ile gez, çalış, paylaş.",
};

const PAGE_SIZE = 24;

interface PageParams {
  tag?: string;
  q?: string;
  sort?: "popular" | "recent";
}

export default async function DiscoverPage(props: PageProps<"/discover">) {
  const sp = (await props.searchParams) as PageParams;
  const tagFilter = sp.tag?.trim() ?? null;
  const textFilter = sp.q?.trim() ?? null;
  const sort = sp.sort === "recent" ? "recent" : "popular";

  // Always public + ready. Postgres handles the tag containment via jsonb @>
  // and the optional text search via ILIKE on full_name + description.
  // Both predicates are dropped when the relevant param is absent.
  const conditions = [eq(repos.isPrivate, false), eq(repos.status, "ready")];
  if (tagFilter) {
    conditions.push(
      sql`${repos.summary}->'techStack' @> ${JSON.stringify([tagFilter])}::jsonb`,
    );
  }
  if (textFilter) {
    const pattern = `%${textFilter.replace(/[%_\\]/g, "\\$&")}%`;
    conditions.push(
      sql`(${repos.fullName} ILIKE ${pattern} OR coalesce(${repos.description}, '') ILIKE ${pattern})`,
    );
  }

  const orderBy =
    sort === "recent"
      ? [desc(repos.indexedAt)]
      : [desc(repos.fileCount), desc(repos.embeddingCount)];

  const rows = await db
    .select({
      id: repos.id,
      owner: repos.owner,
      name: repos.name,
      fullName: repos.fullName,
      description: repos.description,
      fileCount: repos.fileCount,
      embeddingCount: repos.embeddingCount,
      indexedAt: repos.indexedAt,
      summary: repos.summary,
    })
    .from(repos)
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(PAGE_SIZE);

  // Build the global tag set from the (paged) result so users can chip-filter
  // without an extra query. Real /discover would precompute, but this stays
  // cheap at hackathon scale (≤thousands of repos).
  const tagCounts = new Map<string, number>();
  for (const r of rows) {
    for (const t of r.summary?.techStack ?? []) {
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
  }
  const topTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([t]) => t);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <Compass aria-hidden className="size-6 text-primary" />
          Discover
        </h1>
        <p className="text-sm text-muted-foreground">
          {rows.length} public guide
          {tagFilter && (
            <>
              {" "}· etiket:{" "}
              <span className="font-mono text-foreground">{tagFilter}</span>
            </>
          )}
          {textFilter && (
            <>
              {" "}· arama:{" "}
              <span className="font-mono text-foreground">{textFilter}</span>
            </>
          )}
        </p>
      </header>

      <form
        action="/discover"
        className="mb-4 flex flex-wrap items-center gap-2"
      >
        <div className="relative flex-1 sm:max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            name="q"
            defaultValue={textFilter ?? ""}
            placeholder="Repo adı veya açıklama…"
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
          />
        </div>
        {tagFilter && (
          <input type="hidden" name="tag" value={tagFilter} />
        )}
        <div className="flex items-center gap-1">
          <SortLink current={sort} value="popular" />
          <SortLink current={sort} value="recent" />
        </div>
      </form>

      {(tagFilter || topTags.length > 0) && (
        <div className="mb-6 flex flex-wrap items-center gap-1.5 text-xs">
          {tagFilter && (
            <Link
              href={textFilter ? `/discover?q=${encodeURIComponent(textFilter)}` : "/discover"}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 font-mono text-primary",
              )}
            >
              {tagFilter}
              <X aria-hidden className="size-3" />
            </Link>
          )}
          {topTags
            .filter((t) => t !== tagFilter)
            .slice(0, 12)
            .map((t) => (
              <Link
                key={t}
                href={`/discover?tag=${encodeURIComponent(t)}${
                  textFilter ? `&q=${encodeURIComponent(textFilter)}` : ""
                }`}
                className="rounded-full border border-border bg-card px-2.5 py-0.5 font-mono text-muted-foreground hover:border-primary/40 hover:text-foreground"
              >
                {t}
              </Link>
            ))}
        </div>
      )}

      {rows.length === 0 ? (
        <Empty />
      ) : (
        <ul
          role="list"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/r/${r.owner}/${r.name}`}
                className="flex h-full flex-col gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex items-baseline gap-1">
                  <span className="truncate font-mono text-sm font-semibold">
                    {r.owner}
                    <span className="text-muted-foreground">/</span>
                    {r.name}
                  </span>
                </div>
                <p className="line-clamp-3 text-sm text-muted-foreground">
                  {r.summary?.purpose ?? r.description ?? "—"}
                </p>
                <div className="mt-auto flex flex-wrap gap-1">
                  {(r.summary?.techStack ?? []).slice(0, 4).map((t) => (
                    <span
                      key={t}
                      className="rounded border border-border bg-background/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <GitBranch aria-hidden className="size-3" />
                    {r.fileCount} files
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Flame aria-hidden className="size-3" />
                    {r.embeddingCount} chunks
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SortLink({
  current,
  value,
}: {
  current: "popular" | "recent";
  value: "popular" | "recent";
}) {
  const labels = { popular: "Popüler", recent: "Yeni" };
  return (
    <Link
      href={`/discover?sort=${value}`}
      className={cn(
        "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
        current === value
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {labels[value]}
    </Link>
  );
}

function Empty() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
      <Compass aria-hidden className="mx-auto mb-3 size-8 text-muted-foreground" />
      <p className="font-medium text-foreground">
        Hiç eşleşen public repo yok.
      </p>
      <p className="mt-1">
        Filtreyi kaldırmayı veya{" "}
        <Link href="/" className="text-primary hover:underline">
          yeni bir repo eklemeyi
        </Link>{" "}
        dene.
      </p>
    </div>
  );
}
