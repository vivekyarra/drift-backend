import type { AppContext } from "../types";
import { buildCsrfCookie, buildSessionCookie } from "../utils/cookies";
import {
  generateSecureToken,
  hashDeviceFingerprint,
  sha256Hex,
} from "../utils/crypto";
import { HttpError } from "../utils/errors";
import { jsonResponse, parseJsonBody } from "../utils/http";

interface LoginRequestBody {
  recovery_key?: unknown;
}

interface LoginUserRecord {
  id: string;
  username?: string | null;
  recovery_key_hash: string | null;
  is_active?: boolean;
  is_banned?: boolean;
}

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }

  return diff === 0;
}

async function fetchUserByRecoveryKeyHash(
  ctx: AppContext,
  recoveryKeyHash: string,
): Promise<LoginUserRecord | null> {
  const primary = await ctx.supabase
    .from("users")
    .select("id,username,recovery_key_hash,is_active,is_banned")
    .eq("recovery_key_hash", recoveryKeyHash)
    .maybeSingle();

  if (!primary.error) {
    return primary.data;
  }

  if (primary.error.code === "42703") {
    const fallback = await ctx.supabase
      .from("users")
      .select("id,username,recovery_key_hash")
      .eq("recovery_key_hash", recoveryKeyHash)
      .maybeSingle();

    if (fallback.error) {
      throw new HttpError(500, "Failed to fetch user", { expose: false });
    }

    return fallback.data;
  }

  throw new HttpError(500, "Failed to fetch user", { expose: false });
}

async function createSession(
  ctx: AppContext,
  userId: string,
  token: string,
  tokenHash: string,
  deviceHash: string | null,
  expiresAt: string,
): Promise<void> {
  const insert = await ctx.supabase.from("sessions").insert({
    user_id: userId,
    token_hash: tokenHash,
    device_hash: deviceHash,
    expires_at: expiresAt,
  });

  if (!insert.error) {
    return;
  }

  // Fallback if schema differs
  if (insert.error.code !== "42703") {
    throw new HttpError(500, "Failed to create session", { expose: false });
  }

  const idBasedInsert = await ctx.supabase.from("sessions").insert({
    id: token,
    user_id: userId,
    expires_at: expiresAt,
  } as any);

  if (!idBasedInsert.error) {
    return;
  }

  if (idBasedInsert.error.code !== "42703") {
    throw new HttpError(500, "Failed to create session", { expose: false });
  }

  const minimalInsert = await ctx.supabase.from("sessions").insert({
    id: token,
    user_id: userId,
  } as any);

  if (minimalInsert.error) {
    throw new HttpError(500, "Failed to create session", { expose: false });
  }
}

export async function handleLogin(ctx: AppContext): Promise<Response> {
  const body = await parseJsonBody<LoginRequestBody>(ctx.request);
  const recoveryKey =
    typeof body.recovery_key === "string" ? body.recovery_key.trim() : null;

  if (!recoveryKey) {
    throw new HttpError(400, "Recovery key is required");
  }

  const incomingHash = await sha256Hex(recoveryKey);
  const user = await fetchUserByRecoveryKeyHash(ctx, incomingHash);

  if (!user || !user.recovery_key_hash) {
    throw new HttpError(401, "Invalid credentials");
  }

  if (user.is_active === false) {
    throw new HttpError(403, "Account deactivated");
  }

  if (user.is_banned) {
    throw new HttpError(403, "Account banned");
  }

  if (!timingSafeEqual(incomingHash, user.recovery_key_hash)) {
    throw new HttpError(401, "Invalid credentials");
  }

  const sessionToken = generateSecureToken(48);
  const sessionTokenHash = await sha256Hex(sessionToken);
  const csrfToken = generateSecureToken(32);
  const deviceHash = await hashDeviceFingerprint(ctx.request);
  const sessionExpiresAt = new Date(
    Date.now() + SESSION_MAX_AGE_MS,
  ).toISOString();

  await createSession(
    ctx,
    user.id,
    sessionToken,
    sessionTokenHash,
    deviceHash,
    sessionExpiresAt,
  );

  const headers = new Headers();
  headers.append("Set-Cookie", buildSessionCookie(sessionToken));
  headers.append("Set-Cookie", buildCsrfCookie(csrfToken));

  return jsonResponse({ success: true, session_token: sessionToken }, 200, headers);
}
