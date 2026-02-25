import type { AppConfig, Env } from "../types";

let cachedConfig: AppConfig | null = null;
let cachedRawKey = "";

export function getConfig(env: Env): AppConfig {
  const rawUrl = env.SUPABASE_URL?.trim();
  const rawServiceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const rawKey = `${rawUrl ?? ""}|${rawServiceKey ?? ""}`;

  if (cachedConfig && rawKey === cachedRawKey) {
    return cachedConfig;
  }

  if (!rawUrl || !rawServiceKey) {
    // Fail fast when the Worker starts handling traffic without required secrets.
    throw new Error(
      "Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  cachedConfig = {
    supabaseUrl: rawUrl,
    supabaseServiceRoleKey: rawServiceKey,
  };
  cachedRawKey = rawKey;

  return cachedConfig;
}
