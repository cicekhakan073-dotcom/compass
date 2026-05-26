import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Optional, per-bucket rate limiting backed by Upstash Redis. Reads
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN — if either is missing
 * the limiter degrades to a no-op (always allow) so local development and
 * non-Vercel deploys keep working.
 */
const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis: Redis | null =
  url && token ? new Redis({ url, token }) : null;

const limiters: Record<string, Ratelimit | null> = {};

interface BucketConfig {
  /** Token requests allowed in the window. */
  limit: number;
  /** Window string per @upstash/ratelimit, e.g. "60 s", "1 m", "1 h". */
  window: `${number} ${"s" | "m" | "h"}`;
}

const BUCKETS: Record<"chat" | "ingest", BucketConfig> = {
  chat: { limit: 30, window: "1 m" },
  ingest: { limit: 10, window: "1 h" },
};

function getLimiter(name: keyof typeof BUCKETS): Ratelimit | null {
  if (!redis) return null;
  let limiter = limiters[name];
  if (limiter !== undefined) return limiter;
  const { limit, window } = BUCKETS[name];
  limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window),
    analytics: true,
    prefix: `compass:${name}`,
  });
  limiters[name] = limiter;
  return limiter;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

/**
 * Check a bucket for `identifier` (usually IP+route). Returns { ok: true }
 * with an inferred large allowance when Upstash isn't configured.
 */
export async function rateLimit(
  bucket: keyof typeof BUCKETS,
  identifier: string,
): Promise<RateLimitResult> {
  const limiter = getLimiter(bucket);
  if (!limiter) {
    return {
      ok: true,
      limit: BUCKETS[bucket].limit,
      remaining: BUCKETS[bucket].limit,
      resetMs: 0,
    };
  }
  const res = await limiter.limit(identifier);
  return {
    ok: res.success,
    limit: res.limit,
    remaining: res.remaining,
    resetMs: res.reset - Date.now(),
  };
}

/**
 * Best-effort caller IP. Trusts Vercel's `x-forwarded-for` (first hop) and
 * falls back to "anon" so local dev doesn't break.
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  return "anon";
}

/** Standard headers we attach to 429 + successful responses for debugging. */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
    "X-RateLimit-Reset": String(Math.max(0, Math.round(r.resetMs / 1000))),
  };
}
