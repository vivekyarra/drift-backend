import { HttpError } from "../utils/errors";

interface Bucket {
  count: number;
  windowStartMs: number;
}

const buckets = new Map<string, Bucket>();
const lastActionAtMs = new Map<string, number>();

function cleanup(nowMs: number): void {
  for (const [key, value] of buckets.entries()) {
    if (nowMs - value.windowStartMs > 5 * 60_000) {
      buckets.delete(key);
    }
  }
  for (const [key, timestamp] of lastActionAtMs.entries()) {
    if (nowMs - timestamp > 5 * 60_000) {
      lastActionAtMs.delete(key);
    }
  }
}

export function enforceActionLimit(params: {
  actorKey: string;
  action: string;
  limit: number;
  windowMs: number;
  minIntervalMs?: number;
  errorCode: string;
}): void {
  const nowMs = Date.now();
  const key = `${params.action}:${params.actorKey}`;
  const bucket = buckets.get(key);

  if (!bucket || nowMs - bucket.windowStartMs >= params.windowMs) {
    buckets.set(key, {
      count: 1,
      windowStartMs: nowMs,
    });
  } else {
    if (bucket.count >= params.limit) {
      throw new HttpError(429, "Too many requests", { code: params.errorCode });
    }
    bucket.count += 1;
  }

  if (params.minIntervalMs && params.minIntervalMs > 0) {
    const previousMs = lastActionAtMs.get(key) ?? 0;
    if (previousMs > 0 && nowMs - previousMs < params.minIntervalMs) {
      throw new HttpError(429, "Too many requests", { code: params.errorCode });
    }
    lastActionAtMs.set(key, nowMs);
  }

  if (buckets.size > 40_000 || lastActionAtMs.size > 40_000) {
    cleanup(nowMs);
  }
}
