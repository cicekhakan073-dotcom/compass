import {
  AlertTriangle,
  ArrowRight,
  FileCode,
  Layers,
  Package,
  Sparkles,
} from "lucide-react";
import type { RepoSummary } from "@/db/schema";

interface Props {
  summary: RepoSummary;
  artistOwner?: string; // unused — kept for callsite uniformity
}

/**
 * Read-only render of the architecture summary produced by Prompt 6's
 * Claude Sonnet 4.6 agent. Pure server component; no state, no fetches.
 * Layout: purpose hero → entry points + top modules → tech + gotchas.
 */
export function RepoSummaryCard({ summary }: Props) {
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-start gap-3 border-b border-border bg-gradient-to-br from-primary/10 to-transparent p-5">
        <Sparkles
          aria-hidden
          className="mt-0.5 size-5 shrink-0 text-primary"
        />
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Architecture summary · {summary.generatedBy}
          </span>
          <p className="text-base text-foreground sm:text-lg">{summary.purpose}</p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 p-5 md:grid-cols-2">
        <Section
          icon={FileCode}
          title="Buradan başla"
          empty="—"
          items={summary.entryPoints}
          render={(ep) => (
            <li key={ep.path} className="group flex items-baseline gap-2">
              <ArrowRight
                aria-hidden
                className="mt-1 size-3 shrink-0 text-primary opacity-0 transition-opacity group-hover:opacity-100"
              />
              <div className="flex min-w-0 flex-col">
                <code className="truncate font-mono text-xs text-foreground">
                  {ep.path}
                </code>
                <span className="text-xs text-muted-foreground">{ep.why}</span>
              </div>
            </li>
          )}
        />

        <Section
          icon={Layers}
          title="Ana modüller"
          empty="—"
          items={summary.topModules}
          render={(m) => (
            <li key={m.path} className="flex min-w-0 flex-col gap-0.5">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold">{m.name}</span>
                <code className="truncate font-mono text-[11px] text-muted-foreground">
                  {m.path}
                </code>
              </div>
              <span className="text-xs text-muted-foreground">
                {m.description}
              </span>
            </li>
          )}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 border-t border-border p-5 md:grid-cols-2">
        <div>
          <SectionHeader icon={Package} title="Tech stack" />
          {summary.techStack.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">—</p>
          ) : (
            <ul role="list" className="mt-2 flex flex-wrap gap-1.5">
              {summary.techStack.map((t) => (
                <li
                  key={t}
                  className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 font-mono text-[11px] text-foreground"
                >
                  {t}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <SectionHeader icon={AlertTriangle} title="Dikkat edilmesi gerekenler" />
          {summary.gotchas.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">—</p>
          ) : (
            <ul role="list" className="mt-2 flex flex-col gap-1.5">
              {summary.gotchas.map((g, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1.5 text-xs text-muted-foreground"
                >
                  <span aria-hidden className="text-primary">
                    ⚠
                  </span>
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}

function Section<T>({
  icon,
  title,
  items,
  empty,
  render,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  items: T[];
  empty: string;
  render: (item: T) => React.ReactNode;
}) {
  return (
    <div>
      <SectionHeader icon={icon} title={title} />
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul role="list" className="mt-3 flex flex-col gap-2.5">
          {items.map(render)}
        </ul>
      )}
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
}) {
  return (
    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon aria-hidden className="size-3.5" />
      {title}
    </h3>
  );
}
