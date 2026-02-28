import { requireSession } from "../middleware/auth";
import type { AppContext } from "../types";
import { HttpError } from "../utils/errors";
import { jsonResponse } from "../utils/http";

export async function handleMe(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);

  const { data: user, error } = await ctx.supabase
    .from("users")
    .select("id,username,created_at")
    .eq("id", ctx.session!.userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "Failed to fetch current user", { expose: false });
  }

  if (!user) {
    throw new HttpError(401, "Unauthorized");
  }

  return jsonResponse({
    id: user.id,
    username: user.username,
    created_at: user.created_at,
  });
}
