import { requireSession } from "../middleware/auth";
import type { AppContext } from "../types";
import { HttpError } from "../utils/errors";
import { jsonResponse } from "../utils/http";

export async function handleFeed(ctx: AppContext): Promise<Response> {
  const requestUrl = new URL(ctx.request.url);
  const followingOnly = requestUrl.searchParams.get("following_only") === "true";
  let followedUserIds: string[] | null = null;

  if (followingOnly) {
    await requireSession(ctx);

    const { data: follows, error: followsError } = await ctx.supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", ctx.session!.userId);

    if (followsError) {
      throw new HttpError(500, "Failed to fetch follow relationships", {
        expose: false,
      });
    }

    followedUserIds = (follows ?? []).map((follow) => follow.following_id);
    if (followedUserIds.length === 0) {
      return jsonResponse({ posts: [] });
    }
  }

  const nowIso = new Date().toISOString();
  let query = ctx.supabase
    .from("posts")
    .select(
      "id,user_id,channel,content,image_url,image_blurhash,created_at,expires_at,trust_weight,report_count",
    )
    .eq("hidden", false)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(50);

  if (followingOnly) {
    query = query.in("user_id", followedUserIds!);
  }

  const { data: posts, error } = await query;
  if (error) {
    throw new HttpError(500, "Failed to fetch feed", { expose: false });
  }

  return jsonResponse({
    posts: posts ?? [],
  });
}
