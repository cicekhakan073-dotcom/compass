"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { FileCode, Loader2, Sparkles, X } from "lucide-react";
import type { editor as MonacoEditor } from "monaco-editor";
import { cn } from "@/lib/utils";
import { useViewerStore, type Highlight } from "@/lib/stores/viewerStore";

const Monaco = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      <Loader2 aria-hidden className="mr-2 size-3.5 animate-spin" />
      Monaco yükleniyor…
    </div>
  ),
});

interface Props {
  repoId: number;
  className?: string;
}

interface FileResponse {
  ok: boolean;
  path: string;
  lang: string;
  size: number;
  content: string;
  error?: string;
}

/**
 * Read-only Monaco viewer driven by `viewerStore.activeFilePath`. Fetches the
 * file from /api/repos/[id]/files on change, applies line decorations from
 * the highlight set, and shows an AI focus banner at the top while the
 * banner has fresh data.
 */
export function CodeViewer({ repoId, className }: Props) {
  const activeFilePath = useViewerStore((s) => s.activeFilePath);
  const highlights = useViewerStore((s) => s.highlights);
  const comparePath = useViewerStore((s) => s.comparePath);
  const aiFocus = useViewerStore((s) => s.aiFocus);
  const setAIFocus = useViewerStore((s) => s.setAIFocus);

  const [file, setFile] = useState<FileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<MonacoEditor.IEditorDecorationsCollection | null>(
    null,
  );

  // Fetch file content when activeFilePath changes.
  useEffect(() => {
    if (!activeFilePath) {
      setFile(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/repos/${repoId}/files?path=${encodeURIComponent(activeFilePath)}`,
    )
      .then((r) => r.json())
      .then((data: FileResponse) => {
        if (cancelled) return;
        if (!data.ok) {
          setError(data.error ?? "Dosya yüklenemedi.");
          setFile(null);
        } else {
          setFile(data);
        }
      })
      .catch((err) => !cancelled && setError(String(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [activeFilePath, repoId]);

  // Re-apply line decorations whenever highlights or content change.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (decorationsRef.current) {
      decorationsRef.current.clear();
      decorationsRef.current = null;
    }
    if (highlights.length === 0) return;
    const monaco = (
      window as unknown as {
        monaco?: typeof import("monaco-editor");
      }
    ).monaco;
    if (!monaco) return;
    decorationsRef.current = editor.createDecorationsCollection(
      highlights.map((h) => ({
        range: new monaco.Range(h.startLine, 1, h.endLine, 1),
        options: {
          isWholeLine: true,
          className: "compass-line-highlight",
          linesDecorationsClassName: "compass-line-gutter",
          hoverMessage: h.note ? { value: h.note } : undefined,
        },
      })),
    );
    // Scroll to the first highlight.
    editor.revealLineInCenter(highlights[0].startLine);
  }, [highlights, file?.path]);

  // Auto-dismiss the focus banner after 8s.
  useEffect(() => {
    if (!aiFocus) return;
    const t = window.setTimeout(() => {
      if (useViewerStore.getState().aiFocus?.ts === aiFocus.ts) {
        setAIFocus(null);
      }
    }, 8_000);
    return () => window.clearTimeout(t);
  }, [aiFocus, setAIFocus]);

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden bg-card",
        className,
      )}
    >
      <header className="flex items-center gap-2 border-b border-border bg-background/40 px-3 py-2">
        <FileCode aria-hidden className="size-4 text-primary" />
        <span className="truncate font-mono text-xs">
          {file?.path ?? activeFilePath ?? "(dosya seçilmedi)"}
        </span>
        {file && (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {file.lang} · {file.size}b{highlights.length > 0 && ` · ${highlights.length} highlight`}
          </span>
        )}
      </header>

      {aiFocus && (
        <div className="flex items-start gap-2 border-b border-primary/30 bg-primary/10 px-3 py-2 text-xs">
          <Sparkles
            aria-hidden
            className="mt-0.5 size-3.5 shrink-0 text-primary"
          />
          <div className="min-w-0 flex-1">
            <span className="font-semibold text-foreground">
              compass {focusVerb(aiFocus.tool)}
            </span>
            {aiFocus.note && (
              <span className="ml-1 text-muted-foreground">{aiFocus.note}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setAIFocus(null)}
            aria-label="Kapat"
            className="text-muted-foreground hover:text-foreground"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      )}

      <div
        className={cn(
          "relative flex-1",
          comparePath && "grid grid-rows-2 divide-y divide-border",
        )}
      >
        {!activeFilePath && (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="max-w-sm text-sm text-muted-foreground">
              Soldaki ağaçtan bir dosya seç ya da chat'e bir soru sor — compass
              ilgili dosyayı açıp ilgili satırları işaretler.
            </p>
          </div>
        )}
        {error && (
          <div className="absolute inset-x-3 top-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            ⚠ {error}
          </div>
        )}
        {loading && (
          <div className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded bg-muted/80 px-2 py-0.5 text-xs text-muted-foreground">
            <Loader2 aria-hidden className="size-3 animate-spin" />
            Yükleniyor…
          </div>
        )}
        {file && (
          <Monaco
            height="100%"
            language={mapMonacoLang(file.lang)}
            value={file.content}
            theme="vs-dark"
            options={{
              readOnly: true,
              fontSize: 13,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              renderLineHighlight: "all",
              wordWrap: "off",
              tabSize: 2,
            }}
            onMount={(editor) => {
              editorRef.current = editor;
              // Force a re-apply of decorations after mount.
              if (highlights.length > 0) {
                const monaco = (
                  window as unknown as {
                    monaco?: typeof import("monaco-editor");
                  }
                ).monaco;
                if (monaco) {
                  decorationsRef.current = editor.createDecorationsCollection(
                    highlights.map((h) => ({
                      range: new monaco.Range(h.startLine, 1, h.endLine, 1),
                      options: {
                        isWholeLine: true,
                        className: "compass-line-highlight",
                      },
                    })),
                  );
                  editor.revealLineInCenter(highlights[0].startLine);
                }
              }
            }}
          />
        )}
        {comparePath && (
          <ComparePane repoId={repoId} path={comparePath} />
        )}
      </div>
    </div>
  );
}

interface ComparePaneProps {
  repoId: number;
  path: string;
}

/**
 * Read-only second Monaco instance stacked below the main editor when a
 * tour step's action is `compare`. Fetches its own file content via the
 * same files API; no highlights, no decorations.
 */
function ComparePane({ repoId, path }: ComparePaneProps) {
  const [file, setFile] = useState<FileResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/repos/${repoId}/files?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data: FileResponse) => !cancelled && setFile(data.ok ? data : null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [repoId, path]);

  return (
    <div className="flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
        ↔ <span className="truncate">{path}</span>
        {loading && (
          <Loader2 aria-hidden className="ml-auto size-3 animate-spin" />
        )}
      </div>
      <div className="flex-1">
        {file ? (
          <Monaco
            height="100%"
            language={mapMonacoLang(file.lang)}
            value={file.content}
            theme="vs-dark"
            options={{
              readOnly: true,
              fontSize: 12,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: "off",
              tabSize: 2,
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {loading ? "Yükleniyor…" : "Dosya yüklenemedi."}
          </div>
        )}
      </div>
    </div>
  );
}

function focusVerb(tool: string): string {
  switch (tool) {
    case "openFile":
      return "açtı";
    case "searchCode":
      return "araştırdı";
    case "whoCalls":
      return "çağrı yerlerini taradı";
    case "moduleOverview":
      return "modülü taradı";
    default:
      return "düşünüyor";
  }
}

/** tree-sitter lang id → Monaco language id. */
function mapMonacoLang(lang: string): string {
  switch (lang) {
    case "typescript":
    case "tsx":
      return "typescript";
    case "javascript":
      return "javascript";
    case "python":
      return "python";
    case "rust":
      return "rust";
    case "go":
      return "go";
    default:
      return "plaintext";
  }
}

// Re-export for symmetry with other components.
export type ViewerHighlight = Highlight;
