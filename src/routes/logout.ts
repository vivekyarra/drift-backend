import type { AppContext } from "../types";
import {
  SESSION_COOKIE_NAME,
  clearCsrfCookie,
  clearSessionCookie,
  getCookie,
} from "../utils/cookies";
import { sha256Hex } from "../utils/crypto";
import { HttpError } from "../utils/errors";
import { jsonResponse } from "../utils/http";

async function deleteSessionById(
  ctx: AppContext,
  rawSessionToken: string,
): Promise<void> {
  const { error } = await ctx.supabase
    .from("sessions")
    .delete()
    .eq("id", rawSessionToken);

  // UUID-typed IDs can reject non-UUID tokens in fallback mode.
  if (!error || error.code === "22P02") {
    return;
  }

  throw new HttpError(500, "Failed to clear session", { expose: false });
}

async function revokeSession(
  ctx: AppContext,
  rawSessionToken: string,
): Promise<void> {
  const tokenHash = await sha256Hex(rawSessionToken);
  const { error } = await ctx.supabase
    .from("sessions")
    .delete()
    .eq("token_hash", tokenHash);

  if (!error) {
    return;
  }

  if (error.code === "42703") {
    await deleteSessionById(ctx, rawSessionToken);
    return;
  }

  throw new HttpError(500, "Failed to clear session", { expose: false });
}

export async function handleLogout(ctx: AppContext): Promise<Response> {
  const rawSessionToken = getCookie(ctx.request, SESSION_COOKIE_NAME);
  if (rawSessionToken) {
    await revokeSession(ctx, rawSessionToken);
  }

  return jsonResponse(
    { success: true },
    200,
    (() => {
      const headers = new Headers();
      headers.append("Set-Cookie", clearSessionCookie());
      headers.append("Set-Cookie", clearCsrfCookie());
      return headers;
    })(),
  );
}
