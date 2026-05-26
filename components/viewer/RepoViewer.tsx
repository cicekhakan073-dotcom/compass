"use client";

import { useState } from "react";
import {
  FolderTree as FolderTreeIcon,
  MessagesSquare,
  PanelRight,
  PanelRightClose,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useViewerStore } from "@/lib/stores/viewerStore";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Chat } from "@/components/Chat";
import { FileTree, type FileTreeEntry } from "./FileTree";
import { CodeViewer } from "./CodeViewer";
import { TourPanel } from "./TourPanel";

interface Props {
  repoId: number;
  files: FileTreeEntry[];
  /** Disable the chat panel when embeddings haven't been generated. */
  chatEnabled: boolean;
  className?: string;
}

const CHAT_SUGGESTIONS = [
  "Mimariyi özetle",
  "Entry point dosyaları nereler?",
  "Tipik bir istek hayat döngüsü nedir?",
  "Test stratejisi ne?",
];

/**
 * Three-pane workspace: file tree | code viewer | chat.
 * - lg+        : full grid (260px / fluid / 360px); chat collapsible.
 * - md only    : tree + viewer side-by-side; chat in slide-over.
 * - <md        : viewer takes the whole pane; tree + chat both in sheets,
 *                triggered from floating buttons.
 */
export function RepoViewer({
  repoId,
  files,
  chatEnabled,
  className,
}: Props) {
  const chatOpen = useViewerStore((s) => s.chatOpen);
  const setChatOpen = useViewerStore((s) => s.setChatOpen);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  return (
    <div
      className={cn(
        "relative h-[calc(100vh-3.5rem-3rem-1px)] overflow-hidden",
        className,
      )}
    >
      {/* ─── Desktop / md grid ──────────────────────────────────────── */}
      <div
        className={cn(
          "hidden h-full md:grid",
          "md:grid-cols-[260px_minmax(0,1fr)]",
          chatEnabled && chatOpen && "lg:grid-cols-[260px_minmax(0,1fr)_360px]",
        )}
      >
        <aside className="border-r border-border bg-card/40">
          <header className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Files <span className="text-foreground/60">({files.length})</span>
            {chatEnabled && (
              <button
                type="button"
                onClick={() => setChatOpen(!chatOpen)}
                className="ml-auto hidden rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground lg:inline-flex"
                aria-label={chatOpen ? "Sohbeti gizle" : "Sohbeti aç"}
                title={chatOpen ? "Sohbeti gizle" : "Sohbeti aç"}
              >
                {chatOpen ? (
                  <PanelRightClose aria-hidden className="size-4" />
                ) : (
                  <PanelRight aria-hidden className="size-4" />
                )}
              </button>
            )}
          </header>
          <FileTree files={files} className="h-[calc(100%-2.5rem)]" />
        </aside>

        <main className="flex min-w-0 flex-col border-r border-border">
          <div className="border-b border-border bg-background/30 p-3">
            <TourPanel repoId={repoId} />
          </div>
          <div className="min-h-0 flex-1">
            <CodeViewer repoId={repoId} />
          </div>
        </main>

        {chatEnabled && chatOpen && (
          <aside className="hidden h-full min-w-0 flex-col border-l border-border lg:flex">
            <Chat
              repoId={repoId}
              className="!h-full !rounded-none border-0"
              suggestions={CHAT_SUGGESTIONS}
            />
          </aside>
        )}
      </div>

      {/* ─── Mobile single-pane viewer ─────────────────────────────── */}
      <div className="flex h-full flex-col md:hidden">
        <div className="border-b border-border bg-background/30 p-3">
          <TourPanel repoId={repoId} />
        </div>
        <div className="min-h-0 flex-1">
          <CodeViewer repoId={repoId} />
        </div>
      </div>

      {/* ─── Mobile sheets ─────────────────────────────────────────── */}
      <Sheet open={mobileTreeOpen} onOpenChange={setMobileTreeOpen}>
        <SheetContent side="left" className="w-[88vw] max-w-sm p-0 sm:max-w-sm">
          <SheetHeader className="border-b border-border">
            <SheetTitle className="text-base">
              Files ({files.length})
            </SheetTitle>
          </SheetHeader>
          <div className="h-[calc(100%-3.5rem)] overflow-y-auto">
            <FileTree files={files} />
          </div>
        </SheetContent>
      </Sheet>

      {chatEnabled && (
        <Sheet open={mobileChatOpen} onOpenChange={setMobileChatOpen}>
          <SheetContent side="right" className="w-[92vw] max-w-md p-0 sm:max-w-md">
            <SheetHeader className="sr-only">
              <SheetTitle>compass agent</SheetTitle>
            </SheetHeader>
            <Chat
              repoId={repoId}
              className="!h-full !rounded-none border-0"
              suggestions={CHAT_SUGGESTIONS}
            />
          </SheetContent>
        </Sheet>
      )}

      {/* Mobile FABs (only <md) */}
      <button
        type="button"
        onClick={() => setMobileTreeOpen(true)}
        aria-label="Dosya ağacı"
        className="absolute bottom-4 left-4 grid size-11 place-items-center rounded-full bg-card text-foreground shadow-lg shadow-black/40 ring-1 ring-border md:hidden"
      >
        <FolderTreeIcon aria-hidden className="size-5" />
      </button>
      {chatEnabled && (
        <button
          type="button"
          onClick={() => setMobileChatOpen(true)}
          aria-label="Sohbeti aç"
          className="absolute bottom-4 right-4 grid size-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 md:hidden"
        >
          <MessagesSquare aria-hidden className="size-5" />
        </button>
      )}

      {/* Desktop "expand chat" FAB when chat is closed at lg+ */}
      {chatEnabled && !chatOpen && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          aria-label="Sohbeti aç"
          title="Sohbeti aç"
          className="absolute bottom-4 right-4 hidden size-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 lg:grid"
        >
          <MessagesSquare aria-hidden className="size-5" />
        </button>
      )}
    </div>
  );
}
