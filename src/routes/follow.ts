import { requireSession } from "../middleware/auth";
import { enforceActionLimit } from "../middleware/abuseGuard";
import type { AppContext } from "../types";
import { HttpError } from "../utils/errors";
import { jsonResponse, parseJsonBody } from "../utils/http";
import { createNotification } from "../utils/notifications";
import { sanitizeUuid } from "../utils/sanitize";

interface FollowRequestBody {
  user_id?: unknown;
}

interface FollowUserSummary {
  id: string;
  username: string;
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
  enforceActionLimit({
    actorKey: ctx.session!.userId,
    action: "follow.create",
    limit: 30,
    windowMs: 60_000,
    minIntervalMs: 700,
    errorCode: "FOLLOW_SPAM",
  });

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

  await createNotification(ctx, {
    recipientId: targetUserId,
    actorId: ctx.session!.userId,
    type: "follow",
    title: "New follower",
    body: `@${ctx.session!.username} followed you`,
    entityType: "user",
    entityId: targetUserId,
  });

  return jsonResponse({
    success: true,
  });
}

export async function handleUnfollow(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);
  enforceActionLimit({
    actorKey: ctx.session!.userId,
    action: "follow.delete",
    limit: 30,
    windowMs: 60_000,
    minIntervalMs: 700,
    errorCode: "FOLLOW_SPAM",
  });

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

export async function handleFollowData(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);

  const [followingResult, followersResult] = await Promise.all([
    ctx.supabase
      .from("follows")
      .select("following_id,created_at")
      .eq("follower_id", ctx.session!.userId)
      .order("created_at", { ascending: false }),
    ctx.supabase
      .from("follows")
      .select("follower_id,created_at")
      .eq("following_id", ctx.session!.userId)
      .order("created_at", { ascending: false }),
  ]);

  if (followingResult.error || followersResult.error) {
    throw new HttpError(500, "Failed to fetch follow data", { expose: false });
  }

  const followingRows = followingResult.data ?? [];
  const followersRows = followersResult.data ?? [];
  const followingIds = new Set(followingRows.map((row) => row.following_id));
  const followerIds = new Set(followersRows.map((row) => row.follower_id));

  const userIds = [...new Set([...followingIds, ...followerIds])];
  let userMap = new Map<string, FollowUserSummary>();

  if (userIds.length > 0) {
    const { data: users, error: usersError } = await ctx.supabase
      .from("users")
      .select("id,username")
      .in("id", userIds);

    if (usersError) {
      throw new HttpError(500, "Failed to fetch follow user details", {
        expose: false,
      });
    }

    userMap = new Map(
      (users ?? []).map((user) => [
        user.id,
        {
          id: user.id,
          username: user.username,
        },
      ]),
    );
  }

  const { data: candidates, error: candidatesError } = await ctx.supabase
    .from("users")
    .select("id,username")
    .neq("id", ctx.session!.userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (candidatesError) {
    throw new HttpError(500, "Failed to fetch follow suggestions", {
      expose: false,
    });
  }

  const suggestions = (candidates ?? [])
    .filter((candidate) => !followingIds.has(candidate.id))
    .slice(0, 25)
    .map((candidate) => ({
      id: candidate.id,
      username: candidate.username,
      is_following: false,
    }));

  const following = followingRows.map((row) => ({
    id: row.following_id,
    username: userMap.get(row.following_id)?.username ?? "unknown",
    followed_at: row.created_at,
  }));

  const followers = followersRows.map((row) => ({
    id: row.follower_id,
    username: userMap.get(row.follower_id)?.username ?? "unknown",
    followed_at: row.created_at,
    is_following_back: followingIds.has(row.follower_id),
  }));

  return jsonResponse({
    following,
    followers,
    suggestions,
  });
}
