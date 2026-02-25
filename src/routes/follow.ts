import { requireSession } from "../middleware/auth";
import type { AppContext } from "../types";
import { HttpError } from "../utils/errors";
import { jsonResponse, parseJsonBody } from "../utils/http";
import { sanitizeUuid } from "../utils/sanitize";

interface FollowRequestBody {
  user_id?: unknown;
}

function getFollowTargetUserId(body: FollowRequestBody): string {
  const targetUserId = sanitizeUuid(body.user_id);
  if (!targetUserId) {
    throw new HttpError(400, "user_id must be a valid UUID");
  }

  return targetUserId;
}

export async function handleFollow(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);

  const body = await parseJsonBody<FollowRequestBody>(ctx.request);
  const targetUserId = getFollowTargetUserId(body);

  if (targetUserId === ctx.session!.userId) {
    throw new HttpError(400, "Cannot follow yourself");
  }

  const { error } = await ctx.supabase.from("follows").upsert(
    {
      follower_id: ctx.session!.userId,
      following_id: targetUserId,
    },
    {
      onConflict: "follower_id,following_id",
      ignoreDuplicates: true,
    },
  );

  if (error) {
    if (error.code === "23503") {
      throw new HttpError(404, "Target user not found");
    }
    throw new HttpError(500, "Failed to follow user", { expose: false });
  }

  return jsonResponse({
    success: true,
  });
}

export async function handleUnfollow(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);

  const body = await parseJsonBody<FollowRequestBody>(ctx.request);
  const targetUserId = getFollowTargetUserId(body);

  if (targetUserId === ctx.session!.userId) {
    throw new HttpError(400, "Cannot unfollow yourself");
  }

  const { error } = await ctx.supabase
    .from("follows")
    .delete()
    .eq("follower_id", ctx.session!.userId)
    .eq("following_id", targetUserId);

  if (error) {
    throw new HttpError(500, "Failed to unfollow user", { expose: false });
  }

  return jsonResponse({
    success: true,
  });
}
