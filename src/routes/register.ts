import type { AppContext } from "../types";
import { buildSessionCookie } from "../utils/cookies";
import {
  generateSecureToken,
  hashDeviceFingerprint,
  sha256Hex,
} from "../utils/crypto";
import { HttpError } from "../utils/errors";
import { jsonResponse, parseJsonBody } from "../utils/http";
import { sanitizeUsername } from "../utils/sanitize";

interface RegisterRequestBody {
  username?: unknown;
}

function isUniqueViolation(errorCode: string | undefined): boolean {
  return errorCode === "23505";
}

export async function handleRegister(ctx: AppContext): Promise<Response> {
  const body = await parseJsonBody<RegisterRequestBody>(ctx.request);
  const username = sanitizeUsername(body.username);

  if (!username) {
    throw new HttpError(
      400,
      "Username must be 3-20 characters (letters, numbers, underscore only)",
    );
  }

  const recoveryKey = generateSecureToken(32);
  const recoveryKeyHash = await sha256Hex(recoveryKey);

  const sessionToken = generateSecureToken(48);
  const sessionTokenHash = await sha256Hex(sessionToken);
  const deviceHash = await hashDeviceFingerprint(ctx.request);

  const { data: user, error: userInsertError } = await ctx.supabase
    .from("users")
    .insert({
      username,
      recovery_key_hash: recoveryKeyHash,
    })
    .select("id")
    .single();

  if (userInsertError) {
    if (isUniqueViolation(userInsertError.code)) {
      throw new HttpError(409, "Username is already taken");
    }
    throw new HttpError(500, "Failed to create user", { expose: false });
  }

  const { error: sessionInsertError } = await ctx.supabase.from("sessions").insert({
    user_id: user.id,
    token_hash: sessionTokenHash,
    device_hash: deviceHash,
  });

  if (sessionInsertError) {
    // Prevent orphaned users if session creation fails.
    await ctx.supabase.from("users").delete().eq("id", user.id);
    throw new HttpError(500, "Failed to create session", { expose: false });
  }

  return jsonResponse(
    {
      recovery_key: recoveryKey,
    },
    201,
    {
      "Set-Cookie": buildSessionCookie(sessionToken),
    },
  );
}
