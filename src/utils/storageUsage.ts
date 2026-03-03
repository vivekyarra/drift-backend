import type { AppConfig, AppContext } from "../types";

export interface StorageUsageSnapshot {
  usedBytes: number | null;
  limitBytes: number | null;
  available: boolean;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return null;
}

function pickCloudinaryNumeric(
  source: Record<string, unknown> | null,
  keys: string[],
): number | null {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const candidate = asFiniteNumber(source[key]);
    if (candidate !== null) {
      return candidate;
    }
  }
  return null;
}

export async function fetchSupabaseStorageUsage(
  ctx: AppContext,
): Promise<StorageUsageSnapshot> {
  const rpc = await ctx.supabase.rpc("get_database_storage_stats");

  if (rpc.error) {
    if (rpc.error.code === "PGRST202" || rpc.error.code === "42883") {
      return {
        usedBytes: null,
        limitBytes: ctx.config.supabaseDbLimitBytes,
        available: false,
      };
    }
    return {
      usedBytes: null,
      limitBytes: ctx.config.supabaseDbLimitBytes,
      available: false,
    };
  }

  const rows =
    (rpc.data as unknown as Array<{ database_bytes?: unknown }> | null) ?? [];
  const firstRow = rows.length > 0 ? rows[0] : null;
  const usedBytes = firstRow ? asFiniteNumber(firstRow.database_bytes) : null;

  return {
    usedBytes,
    limitBytes: ctx.config.supabaseDbLimitBytes,
    available: usedBytes !== null,
  };
}

export async function fetchCloudinaryStorageUsage(
  config: AppConfig,
): Promise<StorageUsageSnapshot> {
  if (!config.cloudinaryApiKey || !config.cloudinaryApiSecret) {
    return {
      usedBytes: null,
      limitBytes: null,
      available: false,
    };
  }

  const auth = btoa(`${config.cloudinaryApiKey}:${config.cloudinaryApiSecret}`);
  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudinaryCloudName)}/usage`;
  let response: Response;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 2_500);
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
      },
      signal: abortController.signal,
    });
  } catch {
    clearTimeout(timeoutId);
    return {
      usedBytes: null,
      limitBytes: null,
      available: false,
    };
  } finally {
    clearTimeout(timeoutId);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      usedBytes: null,
      limitBytes: null,
      available: false,
    };
  }

  if (!response.ok || typeof payload !== "object" || payload === null) {
    return {
      usedBytes: null,
      limitBytes: null,
      available: false,
    };
  }

  const root = payload as Record<string, unknown>;
  const storageSection =
    typeof root.storage === "object" && root.storage !== null
      ? (root.storage as Record<string, unknown>)
      : null;

  const usedBytes =
    pickCloudinaryNumeric(storageSection, ["usage", "used", "used_bytes"]) ??
    pickCloudinaryNumeric(root, ["storage_usage", "storage_used_bytes"]);
  const limitBytes =
    pickCloudinaryNumeric(storageSection, ["limit", "max", "limit_bytes"]) ??
    pickCloudinaryNumeric(root, ["storage_limit", "storage_limit_bytes"]);

  return {
    usedBytes,
    limitBytes,
    available: usedBytes !== null || limitBytes !== null,
  };
}
