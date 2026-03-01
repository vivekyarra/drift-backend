import type { AppContext } from "../types";
import { buildCsrfCookie, buildSessionCookie } from "../utils/cookies";
import {
  generateSecureToken,
  hashDeviceFingerprint,
  sha256Hex,
  verifyPassword,
} from "../utils/crypto";
import { HttpError } from "../utils/errors";
import { jsonResponse, parseJsonBody } from "../utils/http";
import { sanitizePassword, sanitizeUsername } from "../utils/sanitize";

interface LoginRequestBody {
  username?: unknown;
  password?: unknown;
}

interface LoginUserRecord {
  id: string;
  username?: string | null;
  password_hash?: string | null;
  recovery_key_hash?: string | null;
  is_active?: boolean;
  is_banned?: boolean;
}

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function fetchUserByUsername(
  ctx: AppContext,
  username: string,
): Promise<LoginUserRecord | null> {
  const primary = await ctx.supabase
    .from("users")
    .select("id,username,password_hash,is_active,is_banned")
    .eq("username", username)
    .maybeSingle();

  if (!primary.error) {
    return primary.data;
  }

  if (primary.error.code === "42703") {
    const fallbackWithPasswordHash = await ctx.supabase
      .from("users")
      .select("id,username,password_hash")
      .eq("username", username)
      .maybeSingle();

    if (!fallbackWithPasswordHash.error) {
      return fallbackWithPasswordHash.data;
    }

    if (fallbackWithPasswordHash.error.code === "42703") {
      const legacyFallback = await ctx.supabase
        .from("users")
        .select("id,username,recovery_key_hash")
        .eq("username", username)
        .maybeSingle();

      if (legacyFallback.error) {
        throw new HttpError(500, "Failed to fetch user", { expose: false });
      }

      return legacyFallback.data;
    }

    throw new HttpError(500, "Failed to fetch user", { expose: false });
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
  const username = sanitizeUsername(body.username);
  const password = sanitizePassword(body.password);

  if (!username || !password) {
    throw new HttpError(400, "Username and password are required");
  }

  const user = await fetchUserByUsername(ctx, username);
  const storedHash = user?.password_hash ?? user?.recovery_key_hash ?? null;
  if (!user || !storedHash) {
    throw new HttpError(401, "Invalid credentials");
  }

  if (user.is_active === false) {
    throw new HttpError(403, "Account deactivated");
  }

  if (user.is_banned) {
    throw new HttpError(403, "Account banned");
  }

  const isValidPassword = await verifyPassword(password, storedHash);
  if (!isValidPassword) {
    throw new HttpError(401, "Invalid credentials");
  }

  const sessionToken = generateSecureToken(48);
  const sessionTokenHash = await sha256Hex(sessionToken);
  const csrfToken = generateSecureToken(32);
  const deviceHash = await hashDeviceFingerprint(ctx.request);
  const sessionExpiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();

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
