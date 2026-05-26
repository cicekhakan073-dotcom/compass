/**
 * Languages we know how to parse with tree-sitter. Order matters: walker uses
 * this list as a priority when capping the per-repo file count, so .ts/.tsx
 * files are picked over .json before we hit the limit.
 *
 * The `chunkTypes` set tells the parser which AST node types to slice out as
 * standalone semantic chunks. Anything else stays attached to its parent.
 */
export type LangId =
  | "typescript"
  | "tsx"
  | "javascript"
  | "python"
  | "go"
  | "rust";

export interface LangSpec {
  id: LangId;
  /** Filename extensions (lowercase, including the dot). */
  extensions: string[];
  /** Tree-sitter wasm grammar filename (sits in tree-sitter-wasms/out). */
  wasmFile: string;
  /** AST node types that should become their own chunk. */
  chunkTypes: Set<string>;
  /** AST node types treated as a top-of-file import block. */
  importTypes: Set<string>;
}

export const LANGUAGES: LangSpec[] = [
  {
    id: "typescript",
    extensions: [".ts", ".mts", ".cts"],
    wasmFile: "tree-sitter-typescript.wasm",
    chunkTypes: new Set([
      "function_declaration",
      "method_definition",
      "class_declaration",
      "abstract_class_declaration",
      "interface_declaration",
      "type_alias_declaration",
      "export_statement",
    ]),
    importTypes: new Set(["import_statement"]),
  },
  {
    id: "tsx",
    extensions: [".tsx"],
    wasmFile: "tree-sitter-tsx.wasm",
    chunkTypes: new Set([
      "function_declaration",
      "method_definition",
      "class_declaration",
      "abstract_class_declaration",
      "interface_declaration",
      "type_alias_declaration",
      "export_statement",
    ]),
    importTypes: new Set(["import_statement"]),
  },
  {
    id: "javascript",
    extensions: [".js", ".mjs", ".cjs", ".jsx"],
    wasmFile: "tree-sitter-javascript.wasm",
    chunkTypes: new Set([
      "function_declaration",
      "method_definition",
      "class_declaration",
      "export_statement",
    ]),
    importTypes: new Set(["import_statement"]),
  },
  {
    id: "python",
    extensions: [".py", ".pyi"],
    wasmFile: "tree-sitter-python.wasm",
    chunkTypes: new Set(["function_definition", "class_definition"]),
    importTypes: new Set(["import_statement", "import_from_statement"]),
  },
  {
    id: "go",
    extensions: [".go"],
    wasmFile: "tree-sitter-go.wasm",
    chunkTypes: new Set([
      "function_declaration",
      "method_declaration",
      "type_declaration",
    ]),
    importTypes: new Set(["import_declaration"]),
  },
  {
    id: "rust",
    extensions: [".rs"],
    wasmFile: "tree-sitter-rust.wasm",
    chunkTypes: new Set([
      "function_item",
      "impl_item",
      "struct_item",
      "enum_item",
      "trait_item",
      "mod_item",
    ]),
    importTypes: new Set(["use_declaration"]),
  },
];

const EXT_TO_LANG = new Map<string, LangSpec>(
  LANGUAGES.flatMap((l) => l.extensions.map((e) => [e, l] as const)),
);

/** Look up a language spec by filename. Returns null for unsupported types. */
export function detectLanguage(path: string): LangSpec | null {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = lower.slice(dot);
  return EXT_TO_LANG.get(ext) ?? null;
}

/** Cross-platform list used by the walker for filter logic. */
export const SUPPORTED_EXTENSIONS = new Set(
  LANGUAGES.flatMap((l) => l.extensions),
);
