import "server-only";
import crypto from "node:crypto";

/**
 * Verify a GitHub-issued HMAC SHA-256 signature against the raw request body.
 * Uses constant-time comparison so timing leaks can't fingerprint the secret.
 *
 * GitHub sends the signature as `sha256=<hex>` in `X-Hub-Signature-256`.
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(rawBody);
  const expected = `sha256=${hmac.digest("hex")}`;
  const aBuf = Buffer.from(signatureHeader);
  const bBuf = Buffer.from(expected);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// ─── Minimal payload typings (only the bits we actually read) ───────────────

export interface InstallationAccount {
  login: string;
  type: string;
}

export interface InstallationRepo {
  id: number;
  name: string;
  full_name: string;
  default_branch?: string;
  private?: boolean;
}

export interface InstallationPayload {
  action:
    | "created"
    | "deleted"
    | "suspend"
    | "unsuspend"
    | "new_permissions_accepted";
  installation: {
    id: number;
    account: InstallationAccount;
    repository_selection: "all" | "selected";
  };
  repositories?: InstallationRepo[];
}

export interface InstallationRepositoriesPayload {
  action: "added" | "removed";
  installation: { id: number; account: InstallationAccount };
  repositories_added: InstallationRepo[];
  repositories_removed: InstallationRepo[];
}

export interface PullRequestPayload {
  action: string; // "opened" | "synchronize" | "reopened" | …
  number: number;
  installation?: { id: number };
  pull_request: {
    number: number;
    title: string;
    head: { sha: string; ref: string };
    base: { ref: string };
    body?: string | null;
    diff_url: string;
    html_url: string;
    user: { login: string };
    additions: number;
    deletions: number;
    changed_files: number;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    default_branch: string;
    owner: { login: string };
    private: boolean;
  };
}
