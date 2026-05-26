import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft, Clock, GitBranch, Hash, Lock } from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/db";
import { files, repos } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IngestButton } from "@/components/IngestButton";
import { IngestProgress } from "@/components/IngestProgress";
import { RepoSummaryCard } from "@/components/RepoSummaryCard";
import { RepoViewer } from "@/components/viewer/RepoViewer";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/r/[owner]/[name]">,
): Promise<Metadata> {
  const { owner, name } = await props.params;
  const repo = await db.query.repos.findFirst({
    where: and(eq(repos.owner, owner), eq(repos.name, name)),
  });
  if (!repo) {
    return { title: `${owner}/${name} — compass` };
  }
  const title = `${repo.fullName} — compass`;
  const description =
    repo.summary?.purpose ??
    repo.description ??
    `AI-guided tour of ${repo.fullName}.`;
  // /r/[o]/[n]/opengraph-image.tsx serves the dynamic PNG automatically;
  // Next wires `og:image` via colocation. We just add the rest of the
  // canonical OG + Twitter metadata.
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      siteName: "compass",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function RepoPage(props: PageProps<"/r/[owner]/[name]">) {
  const { owner, name } = await props.params;

  const repo = await db.query.repos.findFirst({
    where: and(eq(repos.owner, owner), eq(repos.name, name)),
  });
  if (!repo) notFound();

  // Private repos are visible only to the GitHub user who originally
  // ingested them. Public repos are reachable by anyone — that's the
  // whole point of `/discover` and shareable OG links.
  if (repo.isPrivate) {
    const session = await auth();
    const isOwner =
      session?.user?.id && repo.requestedBy === session.user.id;
    if (!isOwner) notFound();
  }

  // When the repo is indexed we hand the whole viewport over to the
  // 3-panel workspace. Otherwise we show the onboarding card.
  if (repo.status === "ready" && repo.fileCount > 0) {
    const fileRows = await db
      .select({ path: files.path, lang: files.lang })
      .from(files)
      .where(eq(files.repoId, repo.id))
      .orderBy(asc(files.path));

    return (
      <>
        <ViewerHeader repo={repo} />
        <RepoViewer
          repoId={repo.id}
          files={fileRows}
          chatEnabled={repo.embeddingCount > 0}
        />
      </>
    );
  }

  // Onboarding view (queued / indexing / failed / no files yet).
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <Link
        href="/"
        className={buttonVariants({ variant: "ghost", size: "sm" }) + " mb-6"}
      >
        <ArrowLeft aria-hidden className="size-4" />
        Ana sayfa
      </Link>

      <header className="flex flex-col gap-1">
        <Link
          href={`https://github.com/${repo.fullName}`}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-muted-foreground hover:text-primary"
        >
          github.com/{repo.fullName} ↗
        </Link>
        <h1 className="font-mono text-3xl font-bold tracking-tight">
          {repo.owner}
          <span className="text-muted-foreground">/</span>
          {repo.name}
        </h1>
        {repo.description && (
          <p className="mt-1 text-base text-muted-foreground">
            {repo.description}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <StatusPill status={repo.status} />
          {repo.isPrivate && (
            <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-yellow-300">
              <Lock aria-hidden className="size-3" />
              private
            </span>
          )}
          <Meta icon={GitBranch}>{repo.defaultBranch}</Meta>
          {repo.headSha && (
            <Meta icon={Hash}>
              <code className="font-mono">{repo.headSha.slice(0, 7)}</code>
            </Meta>
          )}
          <Meta icon={Clock}>
            {repo.indexedAt
              ? new Date(repo.indexedAt).toLocaleString("tr-TR")
              : "henüz indekslenmedi"}
          </Meta>
        </div>
        {repo.summary?.techStack && repo.summary.techStack.length > 0 && (
          <ul role="list" className="mt-3 flex flex-wrap gap-1.5">
            {repo.summary.techStack.slice(0, 10).map((t) => (
              <li key={t}>
                <Link
                  href={`/discover?tag=${encodeURIComponent(t)}`}
                  className="rounded-full border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {t}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </header>

      {repo.summary && (
        <section className="mt-8">
          <RepoSummaryCard summary={repo.summary} />
        </section>
      )}

      <section className="mt-8 rounded-lg border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">İndeksleme durumu</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {explainStatus(repo.status, repo.lastError)}
            </p>
          </div>
          <IngestButton repoId={repo.id} status={repo.status} />
        </div>
        {(repo.status === "queued" || repo.status === "indexing") && (
          <IngestProgress
            repoId={repo.id}
            status={repo.status}
            initialFileCount={repo.fileCount}
            initialEmbeddingCount={repo.embeddingCount}
            className="mt-4"
          />
        )}
        <ul className="mt-6 grid grid-cols-3 gap-4">
          <Stat label="Dosya" value={repo.fileCount} />
          <Stat label="Embedding" value={repo.embeddingCount} />
          <Stat label="HEAD" value={repo.headSha?.slice(0, 7) ?? "—"} mono />
        </ul>
      </section>
    </div>
  );
}

/** Compact bar above the 3-panel viewer with breadcrumb + status + re-index. */
function ViewerHeader({
  repo,
}: {
  repo: NonNullable<Awaited<ReturnType<typeof db.query.repos.findFirst>>>;
}) {
  return (
    <div className="flex h-12 items-center gap-3 border-b border-border bg-card/40 px-3">
      <Link
        href="/"
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
        aria-label="Ana sayfa"
      >
        <ArrowLeft aria-hidden className="size-4" />
      </Link>
      <Link
        href={`https://github.com/${repo.fullName}`}
        target="_blank"
        rel="noreferrer"
        className="truncate font-mono text-sm font-semibold hover:text-primary"
      >
        {repo.fullName}
      </Link>
      <StatusPill status={repo.status} />
      {repo.isPrivate && (
        <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-yellow-300">
          <Lock aria-hidden className="size-2.5" />
          private
        </span>
      )}
      {repo.summary?.techStack && repo.summary.techStack.length > 0 && (
        <ul role="list" className="hidden items-center gap-1 lg:flex">
          {repo.summary.techStack.slice(0, 4).map((t) => (
            <li key={t}>
              <Link
                href={`/discover?tag=${encodeURIComponent(t)}`}
                className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                {t}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
        <Meta icon={GitBranch}>{repo.defaultBranch}</Meta>
        {repo.headSha && (
          <Meta icon={Hash}>
            <code className="font-mono">{repo.headSha.slice(0, 7)}</code>
          </Meta>
        )}
        <Stat compact label="files" value={repo.fileCount} />
        <Stat compact label="emb" value={repo.embeddingCount} />
        <IngestButton repoId={repo.id} status={repo.status} />
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const variants: Record<string, string> = {
    queued: "border-yellow-500/40 bg-yellow-500/10 text-yellow-300",
    indexing: "border-primary/40 bg-primary/10 text-primary",
    ready: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    failed: "border-destructive/40 bg-destructive/10 text-destructive",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider",
        variants[status] ?? variants.queued,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

function Meta({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon aria-hidden className="size-3.5" />
      <span>{children}</span>
    </span>
  );
}

function Stat({
  label,
  value,
  mono = false,
  compact = false,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <span className="inline-flex items-baseline gap-1 font-mono text-[11px] tabular-nums">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground">{value}</span>
      </span>
    );
  }
  return (
    <li className="flex flex-col gap-0.5 rounded-md bg-muted/40 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-base font-semibold tabular-nums",
          mono && "font-mono text-sm",
        )}
      >
        {value}
      </span>
    </li>
  );
}

function explainStatus(status: string, lastError: string | null): string {
  switch (status) {
    case "queued":
      return "Kuyrukta. Worker dosyaları çekmeye başladığında 'indexing' olacak.";
    case "indexing":
      return "İndeksleniyor — dosyalar parse ediliyor, embedding'ler üretiliyor.";
    case "ready":
      return "Hazır. Sohbet için açabilir, dosyalar arasında arama yapabilirsin.";
    case "failed":
      return `Hata: ${lastError ?? "Bilinmeyen sebep"}. Tekrar denemek için ana sayfadan yeniden gönder.`;
    default:
      return status;
  }
}
