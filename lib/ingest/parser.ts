import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Parser from "web-tree-sitter";
import { LANGUAGES, type LangId, type LangSpec } from "./languages";

// web-tree-sitter@0.24 ships its types as a default export with nested
// `Parser.Language` + `Parser.SyntaxNode`. We pin to 0.24 because that's the
// last release whose ABI is compatible with the pre-built grammars shipped by
// tree-sitter-wasms@0.1.x.
type Language = Parser.Language;
type SyntaxNode = Parser.SyntaxNode;

let initPromise: Promise<void> | null = null;
const langCache = new Map<LangId, Language>();

/**
 * Both wasm lookups resolve from process.cwd() rather than via
 * `require.resolve`, because Turbopack rewrites module specifiers to a
 * virtual scheme that doesn't exist on disk. The next.config.ts
 * `outputFileTracingIncludes` block ensures Vercel still bundles these
 * files into the serverless function.
 */
function wasmRuntimePath(): string {
  return join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm");
}

function wasmGrammarPath(filename: string): string {
  return join(process.cwd(), "node_modules", "tree-sitter-wasms", "out", filename);
}

function ensureInit(): Promise<void> {
  if (initPromise) return initPromise;
  const runtimeWasm = wasmRuntimePath();
  initPromise = Parser.init({
    locateFile() {
      return runtimeWasm;
    },
  });
  return initPromise;
}

async function loadLanguage(spec: LangSpec): Promise<Language> {
  const hit = langCache.get(spec.id);
  if (hit) return hit;
  await ensureInit();
  const bytes = await readFile(wasmGrammarPath(spec.wasmFile));
  const lang = await Parser.Language.load(new Uint8Array(bytes));
  langCache.set(spec.id, lang);
  return lang;
}

export interface SemanticChunk {
  kind:
    | "file_summary"
    | "function"
    | "class"
    | "method"
    | "import_block"
    | "doc_block"
    | "raw_chunk";
  content: string;
  symbolName: string | null;
  startLine: number;
  endLine: number;
}

export type DefinitionKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "struct"
  | "trait"
  | "module"
  | "other";

export interface SymbolDefinitionLite {
  name: string;
  kind: DefinitionKind;
  startLine: number;
  endLine: number;
  startByte: number;
  endByte: number;
}

export interface SymbolReferenceLite {
  name: string;
  line: number;
  byteOffset: number;
}

export interface ParseResult {
  chunks: SemanticChunk[];
  definitions: SymbolDefinitionLite[];
  references: SymbolReferenceLite[];
}

const FILE_BYTE_LIMIT = 200_000;
const RAW_CHUNK_LINES = 80;
const MIN_IDENTIFIER_LENGTH = 3;
const MAX_REFERENCES_PER_FILE = 1_500;

const REFERENCE_NODE_TYPES = new Set([
  "identifier",
  "type_identifier",
  "property_identifier",
  "field_identifier",
]);

// Reserved words / shadowed builtins that produce too much noise.
const REFERENCE_BLACKLIST = new Set([
  "true",
  "false",
  "null",
  "none",
  "undefined",
  "self",
  "this",
  "super",
  "console",
  "string",
  "number",
  "boolean",
  "any",
  "void",
  "object",
  "unknown",
  "never",
  "import",
  "export",
  "default",
  "from",
  "return",
  "async",
  "await",
  "yield",
  "let",
  "const",
  "var",
  "fn",
  "def",
  "func",
]);

/**
 * Parse `source` with the grammar for `spec` and return semantic chunks.
 *
 * Strategy:
 *   1. Pull the contiguous import block at top-of-file (if any) into one
 *      `import_block` chunk — useful context for any retrieval hit.
 *   2. Walk the tree once, emit one chunk per top-level node whose type is
 *      in `spec.chunkTypes`. Symbol name is extracted from the `name` field
 *      (or whatever child is an identifier).
 *   3. If no semantic chunks were produced (template files, generated
 *      bundles, unsupported nesting) emit raw_chunks of ~80 lines each.
 */
export async function parseFile(
  source: string,
  spec: LangSpec,
): Promise<ParseResult> {
  // Bail out on massive files — usually generated/minified.
  if (source.length > FILE_BYTE_LIMIT) {
    return { chunks: rawChunks(source), definitions: [], references: [] };
  }

  const language = await loadLanguage(spec);
  const parser = new Parser();
  parser.setLanguage(language);

  let tree;
  try {
    tree = parser.parse(source);
  } catch {
    parser.delete();
    return { chunks: rawChunks(source), definitions: [], references: [] };
  }
  if (!tree) {
    parser.delete();
    return { chunks: rawChunks(source), definitions: [], references: [] };
  }

  const chunks: SemanticChunk[] = [];
  const definitions: SymbolDefinitionLite[] = [];
  const root = tree.rootNode;

  // 1. Import block (contiguous run of import statements at the top).
  const importBlock = collectImportBlock(root, spec, source);
  if (importBlock) chunks.push(importBlock);

  // 2. Semantic chunks + definitions in one walk. We descend one level into
  //    the root and into class bodies so methods become their own chunks.
  const visit = (node: SyntaxNode, depth: number) => {
    if (depth > 4) return;
    for (const child of node.namedChildren) {
      if (!child) continue;
      if (spec.chunkTypes.has(child.type)) {
        const symbolName = extractSymbolName(child);
        const chunkKind = mapKind(child.type);
        chunks.push({
          kind: chunkKind,
          content: source.slice(child.startIndex, child.endIndex),
          symbolName,
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
        });
        if (symbolName) {
          definitions.push({
            name: symbolName,
            kind: mapDefKind(child.type),
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
            startByte: child.startIndex,
            endByte: child.endIndex,
          });
        }
        if (chunkKind === "class") visit(child, depth + 1);
      } else if (child.type === "class_body" || child.type === "block") {
        visit(child, depth + 1);
      }
    }
  };
  visit(root, 0);

  // 3. Reference walk — every identifier-style node that *isn't* the `name`
  //    field of a definition we just captured. We use a Set of byte offsets
  //    to filter out the definition-name occurrences cheaply.
  const references = collectReferences(root, definitions);

  tree.delete();
  parser.delete();

  if (chunks.length === 0) {
    return { chunks: rawChunks(source), definitions, references };
  }
  return { chunks, definitions, references };
}

function collectReferences(
  root: SyntaxNode,
  definitions: SymbolDefinitionLite[],
): SymbolReferenceLite[] {
  // Build a set of byte offsets that correspond to the *name* of a captured
  // definition so we don't double-count it as a reference.
  const definitionNameOffsets = new Set<number>();
  // Slight hack: we only need to skip the exact name token; we re-walk and
  // collect those positions from each definition's containing node.
  // For simplicity, we filter post-hoc using line + name match. The line
  // number is a good enough discriminator inside one file.
  const definitionLineByName = new Map<string, Set<number>>();
  for (const d of definitions) {
    let set = definitionLineByName.get(d.name);
    if (!set) {
      set = new Set();
      definitionLineByName.set(d.name, set);
    }
    set.add(d.startLine);
  }

  const out: SymbolReferenceLite[] = [];
  const idNodes = root.descendantsOfType(Array.from(REFERENCE_NODE_TYPES));
  for (const node of idNodes) {
    if (!node) continue;
    const name = node.text;
    if (name.length < MIN_IDENTIFIER_LENGTH) continue;
    if (REFERENCE_BLACKLIST.has(name.toLowerCase())) continue;
    const line = node.startPosition.row + 1;
    const definedHere = definitionLineByName.get(name);
    if (definedHere?.has(line)) continue; // skip definition's own name
    out.push({ name, line, byteOffset: node.startIndex });
    if (out.length >= MAX_REFERENCES_PER_FILE) break;
  }
  void definitionNameOffsets;
  return out;
}

function mapDefKind(astType: string): DefinitionKind {
  if (astType === "interface_declaration") return "interface";
  if (astType.startsWith("type_alias")) return "type";
  if (astType === "struct_item") return "struct";
  if (astType === "trait_item") return "trait";
  if (astType === "mod_item") return "module";
  if (astType.includes("method")) return "method";
  if (astType.includes("class")) return "class";
  if (astType.includes("function") || astType === "function_item") return "function";
  return "other";
}

function mapKind(astType: string): SemanticChunk["kind"] {
  if (astType.includes("class") || astType === "struct_item" || astType === "trait_item") {
    return "class";
  }
  if (astType.includes("method")) return "method";
  if (astType.includes("function") || astType === "function_item") return "function";
  if (astType.includes("export") || astType.includes("type_alias")) return "function";
  return "function";
}

function extractSymbolName(node: SyntaxNode): string | null {
  const named = node.childForFieldName("name");
  if (named) return named.text;
  // Fallback: first identifier-like child.
  for (const child of node.namedChildren) {
    if (!child) continue;
    if (
      child.type === "identifier" ||
      child.type === "type_identifier" ||
      child.type === "property_identifier"
    ) {
      return child.text;
    }
  }
  return null;
}

function collectImportBlock(
  root: SyntaxNode,
  spec: LangSpec,
  source: string,
): SemanticChunk | null {
  let start = -1;
  let end = -1;
  for (const child of root.namedChildren) {
    if (!child) continue;
    if (spec.importTypes.has(child.type)) {
      if (start < 0) start = child.startIndex;
      end = child.endIndex;
    } else if (start >= 0) {
      break;
    }
  }
  if (start < 0 || end <= start) return null;
  const content = source.slice(start, end);
  // Tiny import sections aren't worth retrieving on their own.
  if (content.length < 40) return null;
  return {
    kind: "import_block",
    content,
    symbolName: null,
    startLine: 1,
    endLine: source.slice(0, end).split("\n").length,
  };
}

function rawChunks(source: string): SemanticChunk[] {
  const lines = source.split("\n");
  const chunks: SemanticChunk[] = [];
  for (let i = 0; i < lines.length; i += RAW_CHUNK_LINES) {
    const slice = lines.slice(i, i + RAW_CHUNK_LINES);
    chunks.push({
      kind: "raw_chunk",
      content: slice.join("\n"),
      symbolName: null,
      startLine: i + 1,
      endLine: Math.min(i + slice.length, lines.length),
    });
    if (chunks.length >= 40) break; // hard cap for huge files
  }
  return chunks;
}

// Re-export for callers that want to walk the language list themselves.
export { LANGUAGES };
