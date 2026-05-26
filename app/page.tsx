import { GitBranch, MessageSquare, Sparkles, Zap } from "lucide-react";
import { RepoUrlForm } from "@/components/RepoUrlForm";

export default function Home() {
  return (
    <section className="relative isolate flex flex-1 flex-col">
      <div
        aria-hidden
        className="hero-grid absolute inset-0 -z-10"
      />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-16 text-center sm:py-24">
        <span className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-primary">
          🧭 alpha · prompt 1
        </span>

        <h1 className="mt-6 max-w-2xl text-balance text-4xl font-bold tracking-tight sm:text-6xl">
          Onboarding'i{" "}
          <span className="bg-gradient-to-r from-primary to-[#7ee787] bg-clip-text text-transparent">
            30 saniyeye
          </span>{" "}
          indir
        </h1>

        <p className="mt-4 max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
          Bir GitHub repo URL'si yapıştır. compass kodu tarar, gezdirir,
          sorularını yanıtlar — README okumaya başlamadan önce o codebase'i
          tanıyor olursun.
        </p>

        <div className="mt-10 w-full max-w-xl">
          <RepoUrlForm />
        </div>

        <ul
          role="list"
          className="mt-16 grid w-full max-w-2xl grid-cols-1 gap-3 text-left sm:grid-cols-2"
        >
          <Feature
            icon={Zap}
            title="30 saniyede hazır"
            body="tree-sitter ile dosya seviyesinde semantik chunk, paralel embedding."
          />
          <Feature
            icon={MessageSquare}
            title="Sohbet, monolog değil"
            body="AI dosya açıp satırı highlight'lar, sen sorgulu sorgulu öğrenirsin."
          />
          <Feature
            icon={GitBranch}
            title="Symbol graph"
            body="'Kim çağırıyor?', 'nereden import?' — AST tabanlı referans takibi."
          />
          <Feature
            icon={Sparkles}
            title="Public repo'lar paylaşılabilir"
            body="/r/owner/repo kalıcı, başkalarına gönderilebilir, OG image'lı."
          />
        </ul>
      </div>
    </section>
  );
}

function Feature({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-3 rounded-lg border border-border bg-card/40 p-4">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">{body}</span>
      </div>
    </li>
  );
}
