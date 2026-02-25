import type { AppContext } from "../types";
import { SESSION_COOKIE_NAME, getCookie } from "../utils/cookies";
import { sha256Hex } from "../utils/crypto";
import { HttpError } from "../utils/errors";

export async function requireSession(ctx: AppContext): Promise<void> {
  const rawSessionToken = getCookie(ctx.request, SESSION_COOKIE_NAME);
  if (!rawSessionToken) {
    throw new HttpError(401, "Unauthorized");
  }

  const tokenHash = await sha256Hex(rawSessionToken);
  const { data: session, error: sessionError } = await ctx.supabase
    .from("sessions")
    .select("id,user_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (sessionError) {
    throw new HttpError(500, "Failed to validate session", { expose: false });
  }

  if (!session) {
    throw new HttpError(401, "Unauthorized");
  }

  ctx.session = {
    userId: session.user_id,
    sessionId: session.id,
  };

  // Keep authenticated requests fast; update activity timestamp out-of-band.
  ctx.executionCtx.waitUntil(
    Promise.resolve(
      ctx.supabase
        .from("sessions")
        .update({ last_active: new Date().toISOString() })
        .eq("id", session.id),
    ).then(({ error: lastActiveError }) => {
      if (lastActiveError) {
        console.error("Failed to update session last_active", lastActiveError);
      }
    }),
  );
}
