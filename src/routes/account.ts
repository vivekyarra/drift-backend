import { requireSession } from "../middleware/auth";
import type { AppContext } from "../types";
import { clearCsrfCookie, clearSessionCookie } from "../utils/cookies";
import {
  encryptPasswordForAdmin,
  generateSecureToken,
  hashPassword,
  sha256Hex,
  verifyPassword,
} from "../utils/crypto";
import { HttpError } from "../utils/errors";
import { jsonResponse, parseJsonBody } from "../utils/http";
import { sanitizePassword } from "../utils/sanitize";

interface ChangePasswordRequestBody {
  old_password?: unknown;
  new_password?: unknown;
}

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

export async function handleChangePassword(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);

  const body = await parseJsonBody<ChangePasswordRequestBody>(ctx.request);
  const oldPassword = sanitizePassword(body.old_password);
  const newPassword = sanitizePassword(body.new_password);

  if (!oldPassword || !newPassword) {
    throw new HttpError(400, "Old and new password must be 8-128 characters");
  }

  const userLookup = await ctx.supabase
    .from("users")
    .select("password_hash,recovery_key_hash")
    .eq("id", ctx.session!.userId)
    .maybeSingle();

  if (userLookup.error) {
    throw new HttpError(500, "Failed to verify current password", { expose: false });
  }
  if (!userLookup.data) {
    throw new HttpError(401, "Unauthorized");
  }

  const storedHash = userLookup.data.password_hash ?? userLookup.data.recovery_key_hash ?? null;
  if (!storedHash) {
    throw new HttpError(400, "Current password is not available");
  }

  const isOldPasswordValid = await verifyPassword(oldPassword, storedHash);
  if (!isOldPasswordValid) {
    throw new HttpError(401, "Current password is incorrect");
  }

  const nextPasswordHash = await hashPassword(newPassword);
  const nextPasswordCiphertext = ctx.config.adminPasswordEncryptionKey
    ? await encryptPasswordForAdmin(newPassword, ctx.config.adminPasswordEncryptionKey)
    : null;

  const primaryUpdate = await ctx.supabase
    .from("users")
    .update({
      password_hash: nextPasswordHash,
      password_ciphertext: nextPasswordCiphertext,
    })
    .eq("id", ctx.session!.userId);

  if (!primaryUpdate.error) {
    return jsonResponse({ success: true });
  }

  if (primaryUpdate.error.code === "42703") {
    const noCipherUpdate = await ctx.supabase
      .from("users")
      .update({
        password_hash: nextPasswordHash,
      })
      .eq("id", ctx.session!.userId);

    if (!noCipherUpdate.error) {
      return jsonResponse({ success: true });
    }

    if (noCipherUpdate.error.code === "42703") {
      const legacyUpdate = await ctx.supabase
        .from("users")
        .update({
          recovery_key_hash: nextPasswordHash,
        })
        .eq("id", ctx.session!.userId);

      if (!legacyUpdate.error) {
        return jsonResponse({ success: true });
      }
    }
  }

  throw new HttpError(500, "Failed to change password", { expose: false });
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
