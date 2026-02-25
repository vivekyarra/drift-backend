import { jsonResponse, clientIpFromRequest } from "../utils/http";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 5;

interface RateLimitEntry {
  count: number;
  windowStartMs: number;
}

// Cloudflare isolates keep module state hot between requests, which makes this
// a simple baseline limiter for Phase 1 without external storage.
const rateLimitStore = new Map<string, RateLimitEntry>();

function cleanupExpiredEntries(nowMs: number) {
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (nowMs - entry.windowStartMs >= WINDOW_MS) {
      rateLimitStore.delete(ip);
    }
  }
}

export function enforceRateLimit(request: Request): Response | null {
  const nowMs = Date.now();
  const clientIp = clientIpFromRequest(request);
  const existingEntry = rateLimitStore.get(clientIp);

  if (!existingEntry || nowMs - existingEntry.windowStartMs >= WINDOW_MS) {
    rateLimitStore.set(clientIp, {
      count: 1,
      windowStartMs: nowMs,
    });

    if (rateLimitStore.size > 20_000) {
      cleanupExpiredEntries(nowMs);
    }
    return null;
  }

  if (existingEntry.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((WINDOW_MS - (nowMs - existingEntry.windowStartMs)) / 1000),
    );

    return jsonResponse(
      { error: "Too many requests" },
      429,
      {
        "Retry-After": retryAfterSeconds.toString(),
        "X-RateLimit-Limit": MAX_REQUESTS_PER_WINDOW.toString(),
        "X-RateLimit-Remaining": "0",
      },
    );
  }

  existingEntry.count += 1;
  return null;
}
