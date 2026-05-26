import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import {
  CheckCircle2,
  ExternalLink,
  GitBranch as Github,
  Info,
  ListPlus,
  Loader2,
} from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/db";
import { installations, repos } from "@/db/schema";
import { appInstallUrl, githubAppConfigured } from "@/lib/github/app";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "GitHub App · compass",
};

export default async function InstallSettingsPage(
  props: PageProps<"/settings/install">,
) {
  const sp = await props.searchParams;
  const installed = typeof sp.installed === "string" ? sp.installed : null;
  const queued = typeof sp.queued === "string" ? Number(sp.queued) : null;

  const configured = githubAppConfigured();
  const installUrl = appInstallUrl();
  const session = await auth();

  // Show all installations + how many repos they own. Not user-scoped on
  // purpose — admins debugging the App want the global picture.
  const installRows = configured
    ? await db
        .select({
          id: installations.id,
          ghId: installations.githubInstallationId,
          accountLogin: installations.accountLogin,
          accountType: installations.accountType,
          repoSelection: installations.repoSelection,
          createdAt: installations.createdAt,
        })
        .from(installations)
        .orderBy(desc(installations.createdAt))
    : [];

  const reposByInstallation = configured
    ? await db
        .select({
          installationId: repos.installationId,
          fullName: repos.fullName,
          status: repos.status,
        })
        .from(repos)
        .where(eq(repos.installationId, repos.installationId))
        .orderBy(asc(repos.fullName))
    : [];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Github aria-hidden className="size-6 text-primary" />
          GitHub App
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          compass'ı kendi repolarına yükle. PR'larında otomatik özet comment
          ve "compass'a sor" linki düşer.
        </p>
      </header>

      {installed && (
        <div className="mb-6 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle2 aria-hidden className="mr-2 inline size-4" />
          Kurulum başarılı (installation #{installed}). {queued ?? 0} repo
          kuyruğa alındı — birkaç saniye içinde indekslenmeye başlar.
        </div>
      )}

      {!configured && <NotConfigured />}

      {configured && (
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Repo'na yükle</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            GitHub seni App install ekranına götürür. Hangi repolara erişim
            vereceğini seçer, geri yönlendirilince compass otomatik
            indekslemeye başlar.
          </p>
          <div className="mt-4 flex items-center gap-3">
            {installUrl ? (
              <Link
                href={installUrl}
                className={cn(buttonVariants({ size: "lg" }), "gap-2")}
              >
                <Github aria-hidden className="size-4" />
                Install compass on GitHub
                <ExternalLink aria-hidden className="size-3.5" />
              </Link>
            ) : (
              <p className="text-xs text-destructive">
                ⚠ NEXT_PUBLIC_GITHUB_APP_SLUG tanımlı değil — install URL
                bilinmiyor.
              </p>
            )}
            {!session?.user && (
              <span className="text-xs text-muted-foreground">
                (Auth gerekmiyor — GitHub kendi izin akışını yürütür.)
              </span>
            )}
          </div>
        </section>
      )}

      {configured && installRows.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Aktif kurulumlar ({installRows.length})
          </h2>
          <ul role="list" className="flex flex-col gap-2">
            {installRows.map((row) => {
              const linkedRepos = reposByInstallation.filter(
                (r) => r.installationId === row.id,
              );
              return (
                <li
                  key={row.id}
                  className="rounded-md border border-border bg-card px-4 py-3"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-sm font-semibold">
                      {row.accountLogin}
                    </span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {row.accountType}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      #{row.ghId}
                    </span>
                    <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <ListPlus aria-hidden className="size-3" />
                      {linkedRepos.length} repo
                    </span>
                  </div>
                  {linkedRepos.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {linkedRepos.slice(0, 12).map((repo) => (
                        <li
                          key={repo.fullName}
                          className="rounded border border-border bg-background/40 px-2 py-0.5 font-mono text-[11px]"
                        >
                          {repo.fullName}{" "}
                          <span className="text-muted-foreground">
                            · {repo.status}
                          </span>
                        </li>
                      ))}
                      {linkedRepos.length > 12 && (
                        <li className="text-[11px] text-muted-foreground">
                          +{linkedRepos.length - 12} more
                        </li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Local development
        </h2>
        <div className="rounded-md border border-border bg-card/40 p-4 text-xs leading-relaxed text-muted-foreground">
          <p className="text-foreground">
            <Info aria-hidden className="mr-1 inline size-3" />
            GitHub bir public URL'e webhook gönderir. Lokal makinene
            yönlendirmek için <code>smee.io</code> tüneli kullan:
          </p>
          <pre className="mt-3 overflow-x-auto rounded bg-muted p-3 font-mono text-[11px] text-foreground">{`# 1. smee channel al: https://smee.io/new
# 2. terminal'de:
npx smee-client --url https://smee.io/<your-channel> \\
                --target http://localhost:3000/api/github/webhook`}</pre>
          <p className="mt-3">
            App'i oluştururken Webhook URL'sini smee channel'ın olarak ver,
            secret olarak <code>GITHUB_APP_WEBHOOK_SECRET</code>'ı kullan.
          </p>
        </div>
      </section>
    </div>
  );
}

function NotConfigured() {
  return (
    <section className="rounded-lg border border-dashed border-border bg-card/40 p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Loader2 aria-hidden className="size-4 text-primary" />
        Henüz yapılandırılmadı
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Aşağıdaki üç env değişkeni{" "}
        <code>.env.local</code>'a (veya Vercel'e) eklenince akış aktifleşir.
      </p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <a
            className="text-primary hover:underline"
            href="https://github.com/settings/apps/new"
            target="_blank"
            rel="noreferrer"
          >
            github.com/settings/apps/new
          </a>{" "}
          → App oluştur. Permissions:{" "}
          <code>Contents: read</code> · <code>Pull requests: write</code> ·{" "}
          <code>Metadata: read</code>. Events: <code>Pull request</code> +{" "}
          <code>Installation</code>.
        </li>
        <li>
          Webhook URL:{" "}
          <code>https://your-domain.com/api/github/webhook</code> (lokal için
          smee channel URL'i).
        </li>
        <li>Private key indir + secret oluştur.</li>
        <li>
          <code>.env.local</code>'a ekle:
          <pre className="mt-2 overflow-x-auto rounded bg-muted p-3 font-mono text-[11px] text-foreground">{`GITHUB_APP_ID="123456"
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\\n...\\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET="<long random string>"
NEXT_PUBLIC_GITHUB_APP_SLUG="compass-dev"`}</pre>
        </li>
        <li>
          Setup URL (App ayarlarında):{" "}
          <code>https://your-domain.com/api/github/install/callback</code>
        </li>
      </ol>
    </section>
  );
}
