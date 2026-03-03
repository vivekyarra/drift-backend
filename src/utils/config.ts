import type { AppConfig, Env } from "../types";

let cachedConfig: AppConfig | null = null;
let cachedRawKey = "";

export function getConfig(env: Env): AppConfig {
  const rawUrl = env.SUPABASE_URL?.trim();
  const rawServiceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const rawFrontendOrigin = env.FRONTEND_ORIGIN?.trim();
  const rawCloudinaryCloudName = env.CLOUDINARY_CLOUD_NAME?.trim();
  const rawCloudinaryApiKey = env.CLOUDINARY_API_KEY?.trim();
  const rawCloudinaryApiSecret = env.CLOUDINARY_API_SECRET?.trim();
  const rawAdminApiKey = env.ADMIN_API_KEY?.trim();
  const rawAdminPasswordEncryptionKey = env.ADMIN_PASSWORD_ENCRYPTION_KEY?.trim();
  const rawSupabaseDbLimitBytes = env.SUPABASE_DB_LIMIT_BYTES?.trim();
  const rawKey = `${rawUrl ?? ""}|${rawServiceKey ?? ""}|${rawFrontendOrigin ?? ""}|${rawCloudinaryCloudName ?? ""}|${rawCloudinaryApiKey ?? ""}|${rawCloudinaryApiSecret ?? ""}|${rawAdminApiKey ?? ""}|${rawAdminPasswordEncryptionKey ?? ""}|${rawSupabaseDbLimitBytes ?? ""}`;

  if (cachedConfig && rawKey === cachedRawKey) {
    return cachedConfig;
  }

  if (!rawUrl || !rawServiceKey || !rawFrontendOrigin || !rawCloudinaryCloudName) {
    // Fail fast when the Worker starts handling traffic without required secrets.
    throw new Error(
      "Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FRONTEND_ORIGIN, and CLOUDINARY_CLOUD_NAME",
    );
  }

  let frontendOrigin: string;
  try {
    frontendOrigin = new URL(rawFrontendOrigin).origin;
  } catch {
    throw new Error("FRONTEND_ORIGIN must be a valid absolute origin URL");
  }

  const cloudinaryCloudName = rawCloudinaryCloudName.toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(cloudinaryCloudName)) {
    throw new Error("CLOUDINARY_CLOUD_NAME must contain only letters, numbers, underscore, or dash");
  }

  if (
    (rawCloudinaryApiKey && !rawCloudinaryApiSecret) ||
    (!rawCloudinaryApiKey && rawCloudinaryApiSecret)
  ) {
    throw new Error(
      "CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must be configured together",
    );
  }

  let supabaseDbLimitBytes: number | null = null;
  if (rawSupabaseDbLimitBytes) {
    const parsed = Number.parseInt(rawSupabaseDbLimitBytes, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error("SUPABASE_DB_LIMIT_BYTES must be a positive integer (bytes)");
    }
    supabaseDbLimitBytes = parsed;
  }

  cachedConfig = {
    supabaseUrl: rawUrl,
    supabaseServiceRoleKey: rawServiceKey,
    frontendOrigin,
    cloudinaryCloudName,
    cloudinaryApiKey: rawCloudinaryApiKey ?? null,
    cloudinaryApiSecret: rawCloudinaryApiSecret ?? null,
    adminApiKey: rawAdminApiKey ?? null,
    adminPasswordEncryptionKey: rawAdminPasswordEncryptionKey ?? null,
    supabaseDbLimitBytes,
  };
  cachedRawKey = rawKey;

  return cachedConfig;
}
