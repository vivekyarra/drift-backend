import type { AppContext } from "../types";
import { HttpError } from "./errors";

export type PostExpiryMode = "7d" | "15d" | "30d" | "forever";

export const DEFAULT_POST_EXPIRY_MODE: PostExpiryMode = "15d";
const FOREVER_EXPIRES_AT = "9999-12-31T23:59:59.999Z";

export function isPostExpiryMode(value: unknown): value is PostExpiryMode {
  return value === "7d" || value === "15d" || value === "30d" || value === "forever";
}

export function parsePostExpiryMode(value: unknown): PostExpiryMode | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return isPostExpiryMode(normalized) ? normalized : null;
}

export function computePostExpiresAt(mode: PostExpiryMode): string {
  if (mode === "forever") {
    return FOREVER_EXPIRES_AT;
  }

  const days = mode === "7d" ? 7 : mode === "30d" ? 30 : 15;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export async function readPostExpiryMode(ctx: AppContext): Promise<PostExpiryMode> {
  const setting = await ctx.supabase
    .from("app_settings")
    .select("value_text")
    .eq("key", "post_expiry_mode")
    .maybeSingle();

  if (setting.error) {
    return DEFAULT_POST_EXPIRY_MODE;
  }

  if (!setting.data) {
    return DEFAULT_POST_EXPIRY_MODE;
  }

  const parsed = parsePostExpiryMode(setting.data.value_text);
  return parsed ?? DEFAULT_POST_EXPIRY_MODE;
}

export async function writePostExpiryMode(
  ctx: AppContext,
  mode: PostExpiryMode,
): Promise<void> {
  const upsert = await ctx.supabase.from("app_settings").upsert(
    {
      key: "post_expiry_mode",
      value_text: mode,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  if (upsert.error) {
    const errorCode = upsert.error.code ?? "";
    const errorText = `${upsert.error.message ?? ""} ${upsert.error.details ?? ""}`.toLowerCase();
    if (
      errorCode === "42P01" ||
      errorCode === "42703" ||
      errorCode === "PGRST204" ||
      errorCode === "PGRST205" ||
      errorText.includes("app_settings") ||
      errorText.includes("does not exist")
    ) {
      throw new HttpError(
        503,
        "Post expiry settings table is missing. Apply migration 010_phase9_admin_platform_settings.sql",
      );
    }
    throw new HttpError(500, "Failed to update post expiry mode", { expose: false });
  }
}
