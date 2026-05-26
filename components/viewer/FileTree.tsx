"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useViewerStore } from "@/lib/stores/viewerStore";

export interface FileTreeEntry {
  path: string;
  lang: string;
}

interface Props {
  files: FileTreeEntry[];
  className?: string;
}

interface TreeNode {
  name: string;
  path: string;
  kind: "file" | "dir";
  lang?: string;
  children: TreeNode[];
}

/**
 * Collapsible file tree. Each row has a hover "Ask compass" sparkles button
 * that queues a prompt into the chat input (no nav, no scroll thrash).
 *
 * The shape of the tree is reconstructed from the flat path list each render —
 * memoized on `files` since that's stable for a given repo snapshot.
 */
export function FileTree({ files, className }: Props) {
  const activeFilePath = useViewerStore((s) => s.activeFilePath);
  const setActiveFile = useViewerStore((s) => s.setActiveFile);
  const askCompass = useViewerStore((s) => s.askCompass);

  const root = useMemo(() => buildTree(files), [files]);

  return (
    <nav
      aria-label="File tree"
      className={cn("h-full overflow-y-auto p-2 text-sm", className)}
    >
      {root.children.length === 0 ? (
        <p className="px-2 py-4 text-xs text-muted-foreground">Boş ağaç.</p>
      ) : (
        <ul role="tree" className="flex flex-col gap-0.5">
          {root.children.map((c) => (
            <TreeRow
              key={c.path}
              node={c}
              depth={0}
              activePath={activeFilePath}
              onOpenFile={(p) => setActiveFile(p, [])}
              onAskCompass={(p) =>
                askCompass(`\`${p}\` dosyasında ne var? Kısaca özetle.`)
              }
            />
          ))}
        </ul>
      )}
    </nav>
  );
}

function TreeRow({
  node,
  depth,
  activePath,
  onOpenFile,
  onAskCompass,
}: {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  onOpenFile: (p: string) => void;
  onAskCompass: (p: string) => void;
}) {
  // Folders open by default at depth 0; everything else starts collapsed.
  const [open, setOpen] = useState(depth === 0);

  if (node.kind === "dir") {
    const Icon = open ? FolderOpen : Folder;
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "group flex w-full items-center gap-1 rounded px-1.5 py-1 text-left hover:bg-muted/50",
          )}
          style={{ paddingLeft: 6 + depth * 12 }}
        >
          {open ? (
            <ChevronDown aria-hidden className="size-3 text-muted-foreground" />
          ) : (
            <ChevronRight aria-hidden className="size-3 text-muted-foreground" />
          )}
          <Icon aria-hidden className="size-3.5 text-primary" />
          <span className="truncate font-medium">{node.name}</span>
          <span className="ml-auto opacity-0 group-hover:opacity-100">
            <AskButton
              onClick={(e) => {
                e.stopPropagation();
                onAskCompass(node.path);
              }}
            />
          </span>
        </button>
        {open && (
          <ul role="group" className="flex flex-col gap-0.5">
            {node.children.map((c) => (
              <TreeRow
                key={c.path}
                node={c}
                depth={depth + 1}
                activePath={activePath}
                onOpenFile={onOpenFile}
                onAskCompass={onAskCompass}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const isActive = node.path === activePath;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpenFile(node.path)}
        className={cn(
          "group flex w-full items-center gap-1 rounded px-1.5 py-1 text-left transition-colors",
          isActive ? "bg-primary/15 text-foreground" : "hover:bg-muted/50",
        )}
        style={{ paddingLeft: 6 + depth * 12 + 12 }}
      >
        <File
          aria-hidden
          className={cn(
            "size-3.5 shrink-0",
            isActive ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="truncate">{node.name}</span>
        <span className="ml-auto opacity-0 group-hover:opacity-100">
          <AskButton
            onClick={(e) => {
              e.stopPropagation();
              onAskCompass(node.path);
            }}
          />
        </span>
      </button>
    </li>
  );
}

function AskButton({
  onClick,
}: {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(e as unknown as React.MouseEvent<HTMLButtonElement>);
        }
      }}
      title="Ask compass"
      className="inline-flex size-5 cursor-pointer items-center justify-center rounded text-primary hover:bg-primary/15"
    >
      <Sparkles aria-hidden className="size-3" />
    </span>
  );
}

/**
 * Walk the flat path list and produce a nested tree where directories come
 * before files at each level, both sorted alphabetically.
 */
function buildTree(files: FileTreeEntry[]): TreeNode {
  const root: TreeNode = { name: "/", path: "", kind: "dir", children: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let cursor = root;
    let accum = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      accum = accum ? `${accum}/${part}` : part;
      const isFile = i === parts.length - 1;
      let next = cursor.children.find((c) => c.name === part);
      if (!next) {
        next = {
          name: part,
          path: accum,
          kind: isFile ? "file" : "dir",
          lang: isFile ? f.lang : undefined,
          children: [],
        };
        cursor.children.push(next);
      }
      cursor = next;
    }
  }
  // Sort: dirs before files, then alphabetical.
  const sortRec = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const c of node.children) if (c.kind === "dir") sortRec(c);
  };
  sortRec(root);
  return root;
}
