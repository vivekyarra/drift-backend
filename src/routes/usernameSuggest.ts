import type { AppContext } from "../types";
import { HttpError } from "../utils/errors";
import { jsonResponse } from "../utils/http";
import { sanitizeUsername, sanitizeUsernameBase } from "../utils/sanitize";

const DEFAULT_BASES = ["voidvaultuser", "anonymoususer"] as const;

function randomBase(): string {
  const index = Math.floor(Math.random() * DEFAULT_BASES.length);
  return DEFAULT_BASES[index];
}

function pickAvailableUsername(base: string, existing: string[]): string {
  const taken = new Set(existing.map((value) => value.toLowerCase()));
  if (!taken.has(base)) {
    return base;
  }

  let maxSuffix = 0;
  for (const username of taken) {
    if (!username.startsWith(base)) {
      continue;
    }
    const suffix = username.slice(base.length);
    if (!suffix) {
      maxSuffix = Math.max(maxSuffix, 1);
      continue;
    }
    if (!/^\d+$/.test(suffix)) {
      continue;
    }
    const parsed = Number.parseInt(suffix, 10);
    if (Number.isFinite(parsed) && parsed > maxSuffix) {
      maxSuffix = parsed;
    }
  }

  for (let candidate = Math.max(1, maxSuffix); candidate < 999_999; candidate += 1) {
    const username = `${base}${candidate}`;
    if (username.length > 20) {
      break;
    }
    if (!taken.has(username)) {
      return username;
    }
  }

  const fallback = `${base}${Math.floor(1000 + Math.random() * 9000)}`.slice(0, 20);
  return sanitizeUsername(fallback) ?? `${base.slice(0, 12)}${Date.now().toString().slice(-4)}`;
}

export async function handleUsernameSuggest(ctx: AppContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const requestedBase = sanitizeUsernameBase(url.searchParams.get("base"));
  const base = requestedBase ?? randomBase();

  const { data, error } = await ctx.supabase
    .from("users")
    .select("username")
    .ilike("username", `${base}%`)
    .limit(500);

  if (error) {
    throw new HttpError(500, "Failed to generate username", { expose: false });
  }

  const suggestion = pickAvailableUsername(
    base,
    (data ?? []).map((row) => row.username),
  );

  return jsonResponse({
    username: suggestion,
  });
}
