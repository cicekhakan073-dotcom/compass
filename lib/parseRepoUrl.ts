/**
 * Tolerant GitHub URL/slug parser. Accepts any of:
 *   - https://github.com/owner/repo
 *   - github.com/owner/repo
 *   - owner/repo
 *   - owner/repo.git
 * Returns null on garbage so callers can validate with `=== null`.
 */
export function parseRepoUrl(input: string): { owner: string; name: string } | null {
  const trimmed = input.trim().replace(/\.git\/?$/, "");
  if (!trimmed) return null;
  const m = trimmed.match(
    /^(?:https?:\/\/(?:www\.)?github\.com\/|github\.com\/)?([^/\s]+)\/([^/\s]+)\/?$/,
  );
  if (!m) return null;
  return { owner: m[1], name: m[2] };
}
