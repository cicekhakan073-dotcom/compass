import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The ingestion route reads tree-sitter wasm grammars and the web-tree-sitter
  // runtime from node_modules at runtime. Vercel's static analysis sometimes
  // misses wasm files referenced via `require.resolve()`, so we explicitly
  // include them in the function bundle for that route.
  outputFileTracingIncludes: {
    "/api/repos/[id]/ingest": [
      "./node_modules/web-tree-sitter/tree-sitter.wasm",
      "./node_modules/tree-sitter-wasms/out/tree-sitter-typescript.wasm",
      "./node_modules/tree-sitter-wasms/out/tree-sitter-tsx.wasm",
      "./node_modules/tree-sitter-wasms/out/tree-sitter-javascript.wasm",
      "./node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm",
      "./node_modules/tree-sitter-wasms/out/tree-sitter-go.wasm",
      "./node_modules/tree-sitter-wasms/out/tree-sitter-rust.wasm",
    ],
  },
};

export default nextConfig;
