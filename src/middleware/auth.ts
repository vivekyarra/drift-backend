import type { AppContext } from "../types";
import { SESSION_COOKIE_NAME, getCookie } from "../utils/cookies";
import { sha256Hex } from "../utils/crypto";
import { HttpError } from "../utils/errors";
import { logAsyncWarning } from "../utils/logger";

interface SessionRecord {
  id: string;
  user_id: string;
  expires_at: string | null;
  created_at: string | null;
}

interface UserFlags {
  username: string;
  is_active: boolean;
  is_banned: boolean;
  is_shadow_banned: boolean;
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!authorization) {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

async function querySessionByField(
  ctx: AppContext,
  field: "token_hash" | "id",
  value: string,
): Promise<SessionRecord | null> {
  const withExpiry = await ctx.supabase
    .from("sessions")
    .select("id,user_id,expires_at,created_at")
    .eq(field, value)
    .maybeSingle();

  if (!withExpiry.error) {
    return withExpiry.data;
  }

  if (withExpiry.error.code === "22P02" && field === "id") {
    return null;
  }

  if (withExpiry.error.code !== "42703") {
    throw new HttpError(500, "Failed to validate session", { expose: false });
  }

  const withoutExpiry = await ctx.supabase
    .from("sessions")
    .select("id,user_id,created_at")
    .eq(field, value)
    .maybeSingle();

  if (!withoutExpiry.error) {
    if (!withoutExpiry.data) {
      return null;
    }

    return {
      id: withoutExpiry.data.id,
      user_id: withoutExpiry.data.user_id,
      expires_at: null,
      created_at: withoutExpiry.data.created_at,
    };
  }

  if (withoutExpiry.error.code === "42703") {
    // Older schemas may also miss created_at in sessions.
    const minimalFallback = await ctx.supabase
      .from("sessions")
      .select("id,user_id")
      .eq(field, value)
      .maybeSingle();

    if (!minimalFallback.error) {
      if (!minimalFallback.data) {
        return null;
      }

      return {
        id: minimalFallback.data.id,
        user_id: minimalFallback.data.user_id,
        expires_at: null,
        created_at: null,
      };
    }

    if (minimalFallback.error.code === "22P02" && field === "id") {
      return null;
    }

    if (minimalFallback.error.code === "42703" && field === "token_hash") {
      return null;
    }
  }

  if (withoutExpiry.error.code === "22P02" && field === "id") {
    return null;
  }

  if (withoutExpiry.error.code === "42703" && field === "token_hash") {
    // token_hash does not exist in this schema; caller should fall back to id.
    return null;
  }

  throw new HttpError(500, "Failed to validate session", { expose: false });
}

async function fetchUserFlags(
  ctx: AppContext,
  userId: string,
): Promise<UserFlags | null> {
  const primary = await ctx.supabase
    .from("users")
    .select("username,is_active,is_banned,is_shadow_banned")
    .eq("id", userId)
    .maybeSingle();

  if (!primary.error) {
    if (!primary.data) {
      return null;
    }
    return {
      username: primary.data.username,
      is_active: primary.data.is_active,
      is_banned: primary.data.is_banned,
      is_shadow_banned: primary.data.is_shadow_banned,
    };
  }

  if (primary.error.code !== "42703") {
    throw new HttpError(500, "Failed to validate user session", { expose: false });
  }

  const fallback = await ctx.supabase
    .from("users")
    .select("username")
    .eq("id", userId)
    .maybeSingle();

  if (fallback.error) {
    throw new HttpError(500, "Failed to validate user session", { expose: false });
  }
  if (!fallback.data) {
    return null;
  }

  return {
    username: fallback.data.username,
    is_active: true,
    is_banned: false,
    is_shadow_banned: false,
  };
}

export async function requireSession(ctx: AppContext): Promise<void> {
  const LEGACY_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  const rawSessionToken =
    getCookie(ctx.request, SESSION_COOKIE_NAME) ?? getBearerToken(ctx.request);
  if (!rawSessionToken) {
    throw new HttpError(401, "Unauthorized");
  }

  const tokenHash = await sha256Hex(rawSessionToken);
  let session = await querySessionByField(ctx, "token_hash", tokenHash);
  if (!session) {
    session = await querySessionByField(ctx, "id", rawSessionToken);
  }

  if (!session) {
    throw new HttpError(401, "Unauthorized");
  }

  let expiresAtMs = Number.NaN;
  if (session.expires_at) {
    expiresAtMs = new Date(session.expires_at).getTime();
  } else if (session.created_at) {
    expiresAtMs = new Date(session.created_at).getTime() + LEGACY_SESSION_TTL_MS;
  }

  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    // Expired sessions are revoked immediately.
    await ctx.supabase.from("sessions").delete().eq("id", session.id);
    throw new HttpError(401, "Session expired");
  }

  const userFlags = await fetchUserFlags(ctx, session.user_id);
  if (!userFlags) {
    throw new HttpError(401, "Unauthorized");
  }

  if (!userFlags.is_active) {
    throw new HttpError(403, "Account deactivated");
  }

  if (userFlags.is_banned) {
    throw new HttpError(403, "Account banned");
  }

  ctx.session = {
    userId: session.user_id,
    sessionId: session.id,
    username: userFlags.username,
    isBanned: userFlags.is_banned,
    isShadowBanned: userFlags.is_shadow_banned,
    isActive: userFlags.is_active,
  };

  // Keep authenticated requests fast; update activity timestamp out-of-band.
  ctx.executionCtx.waitUntil(
    Promise.resolve(
      ctx.supabase
        .from("sessions")
        .update({
          last_active: new Date().toISOString(),
          ...(session.expires_at
            ? {}
            : {
                expires_at: new Date(Date.now() + LEGACY_SESSION_TTL_MS).toISOString(),
              }),
        })
        .eq("id", session.id),
    ).then(({ error: lastActiveError }) => {
      if (lastActiveError && lastActiveError.code !== "42703") {
        logAsyncWarning(
          ctx,
          "session.last_active.update_failed",
          "Failed to update session activity",
        );
      }
    }),
  );
}
