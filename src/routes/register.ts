import type { AppContext } from "../types";
import { buildCsrfCookie, buildSessionCookie } from "../utils/cookies";
import {
  encryptPasswordForAdmin,
  generateSecureToken,
  hashDeviceFingerprint,
  hashPassword,
  sha256Hex,
} from "../utils/crypto";
import { HttpError } from "../utils/errors";
import { jsonResponse, parseJsonBody } from "../utils/http";
import { sanitizePassword, sanitizeUsername } from "../utils/sanitize";

interface RegisterRequestBody {
  username?: unknown;
  password?: unknown;
}

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isUniqueViolation(errorCode: string | undefined): boolean {
  return errorCode === "23505";
}

export async function handleRegister(ctx: AppContext): Promise<Response> {
  const body = await parseJsonBody<RegisterRequestBody>(ctx.request);
  const username = sanitizeUsername(body.username);
  const password = sanitizePassword(body.password);

  if (!username) {
    throw new HttpError(
      400,
      "Username must be 3-20 characters (letters, numbers, underscore only)",
    );
  }
  if (!password) {
    throw new HttpError(400, "Password must be 8-128 characters");
  }

  // Keep a non-null recovery key hash for backward-compatible schema usage.
  const recoveryKeyHash = await sha256Hex(generateSecureToken(48));
  const passwordHash = await hashPassword(password);
  const passwordCiphertext = ctx.config.adminPasswordEncryptionKey
    ? await encryptPasswordForAdmin(password, ctx.config.adminPasswordEncryptionKey)
    : null;

  const sessionToken = generateSecureToken(48);
  const sessionTokenHash = await sha256Hex(sessionToken);
  const csrfToken = generateSecureToken(32);
  const deviceHash = await hashDeviceFingerprint(ctx.request);
  const sessionExpiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();

  const insertUser = async (withCiphertext: boolean) =>
    ctx.supabase
      .from("users")
      .insert({
        username,
        recovery_key_hash: recoveryKeyHash,
        password_hash: passwordHash,
        ...(withCiphertext ? { password_ciphertext: passwordCiphertext } : {}),
        trust_score: 100,
      })
      .select("id")
      .single();

  let { data: user, error: userInsertError } = await insertUser(true);
  if (userInsertError?.code === "42703") {
    ({ data: user, error: userInsertError } = await insertUser(false));
  }

  if (userInsertError) {
    if (isUniqueViolation(userInsertError.code)) {
      throw new HttpError(409, "Username is already taken");
    }
    throw new HttpError(500, "Failed to create user", { expose: false });
  }
  if (!user) {
    throw new HttpError(500, "Failed to create user", { expose: false });
  }

  const sessionInsertWithExpiry = await ctx.supabase.from("sessions").insert({
    user_id: user.id,
    token_hash: sessionTokenHash,
    device_hash: deviceHash,
    expires_at: sessionExpiresAt,
  });

  if (sessionInsertWithExpiry.error) {
    let sessionCreated = false;

    if (sessionInsertWithExpiry.error.code === "42703") {
      const sessionInsertWithoutExpiry = await ctx.supabase.from("sessions").insert({
        user_id: user.id,
        token_hash: sessionTokenHash,
        device_hash: deviceHash,
      });

      if (!sessionInsertWithoutExpiry.error) {
        sessionCreated = true;
      } else if (sessionInsertWithoutExpiry.error.code === "42703") {
        const idBasedInsertWithExpiry = await ctx.supabase.from("sessions").insert({
          id: sessionToken,
          user_id: user.id,
          expires_at: sessionExpiresAt,
        } as any);

        if (!idBasedInsertWithExpiry.error) {
          sessionCreated = true;
        } else if (idBasedInsertWithExpiry.error.code === "42703") {
          const idBasedInsertMinimal = await ctx.supabase.from("sessions").insert({
            id: sessionToken,
            user_id: user.id,
          } as any);

          if (!idBasedInsertMinimal.error) {
            sessionCreated = true;
          }
        }
      }
    }

    if (!sessionCreated) {
      // Prevent orphaned users if session creation fails.
      await ctx.supabase.from("users").delete().eq("id", user.id);
      throw new HttpError(500, "Failed to create session", { expose: false });
    }
  }

  const headers = new Headers();
  headers.append("Set-Cookie", buildSessionCookie(sessionToken));
  headers.append("Set-Cookie", buildCsrfCookie(csrfToken));

  return jsonResponse(
    {
      success: true,
      session_token: sessionToken,
    },
    201,
    headers,
  );
}
