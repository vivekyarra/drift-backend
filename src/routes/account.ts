import { requireSession } from "../middleware/auth";
import type { AppContext } from "../types";
import { clearCsrfCookie, clearSessionCookie } from "../utils/cookies";
import { generateSecureToken, sha256Hex } from "../utils/crypto";
import { HttpError } from "../utils/errors";
import { jsonResponse } from "../utils/http";

export async function handleRotateRecoveryKey(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);

  const nextRecoveryKey = generateSecureToken(32);
  const nextRecoveryKeyHash = await sha256Hex(nextRecoveryKey);

  const { error } = await ctx.supabase
    .from("users")
    .update({
      recovery_key_hash: nextRecoveryKeyHash,
    })
    .eq("id", ctx.session!.userId);

  if (error) {
    throw new HttpError(500, "Failed to rotate recovery key", { expose: false });
  }

  return jsonResponse({
    recovery_key: nextRecoveryKey,
  });
}

export async function handleDeactivateAccount(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);
  const nowIso = new Date().toISOString();

  const updatePrimary = await ctx.supabase
    .from("users")
    .update({
      is_active: false,
      deactivated_at: nowIso,
    })
    .eq("id", ctx.session!.userId);

  if (updatePrimary.error && updatePrimary.error.code !== "42703") {
    throw new HttpError(500, "Failed to deactivate account", { expose: false });
  }

  await ctx.supabase.from("sessions").delete().eq("user_id", ctx.session!.userId);

  const headers = new Headers();
  headers.append("Set-Cookie", clearSessionCookie());
  headers.append("Set-Cookie", clearCsrfCookie());

  return jsonResponse(
    {
      success: true,
      deactivated: true,
    },
    200,
    headers,
  );
}

export async function handleDeleteAccount(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);

  const { error } = await ctx.supabase.from("users").delete().eq("id", ctx.session!.userId);
  if (error) {
    throw new HttpError(500, "Failed to delete account", { expose: false });
  }

  const headers = new Headers();
  headers.append("Set-Cookie", clearSessionCookie());
  headers.append("Set-Cookie", clearCsrfCookie());

  return jsonResponse(
    {
      success: true,
      deleted: true,
    },
    200,
    headers,
  );
}
