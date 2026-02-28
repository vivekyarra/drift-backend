import { requireSession } from "../middleware/auth";
import type { AppContext } from "../types";
import { HttpError } from "../utils/errors";
import { jsonResponse, parseJsonBody } from "../utils/http";
import { createNotification } from "../utils/notifications";
import {
  sanitizeBio,
  sanitizeImageUrl,
  sanitizeUsername,
  sanitizeUuid,
} from "../utils/sanitize";

interface UpdateProfileRequestBody {
  username?: unknown;
  bio?: unknown;
  avatar_url?: unknown;
}

export async function handleProfile(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);

  const requestUrl = new URL(ctx.request.url);
  const rawUserId = requestUrl.searchParams.get("user_id");
  const hasUserId = requestUrl.searchParams.has("user_id");
  const targetUserId = rawUserId ? sanitizeUuid(rawUserId) : null;

  if (hasUserId && !targetUserId) {
    throw new HttpError(400, "user_id must be a valid UUID");
  }

  const requestedUserId = targetUserId ?? ctx.session!.userId;
  const isSelf = requestedUserId === ctx.session!.userId;

  const primaryUser = await ctx.supabase
    .from("users")
    .select("id,username,created_at,trust_score,bio,avatar_url")
    .eq("id", requestedUserId)
    .maybeSingle();

  let user = primaryUser.data;
  let userError = primaryUser.error;

  if (userError?.code === "42703") {
    const fallbackUser = await ctx.supabase
      .from("users")
      .select("id,username,created_at,trust_score")
      .eq("id", requestedUserId)
      .maybeSingle();
    user = fallbackUser.data
      ? {
          ...fallbackUser.data,
          bio: null,
          avatar_url: null,
        }
      : null;
    userError = fallbackUser.error;
  }

  if (userError) {
    throw new HttpError(500, "Failed to fetch profile", { expose: false });
  }

  if (!user) {
    throw new HttpError(404, "User not found");
  }

  const [followersCountResult, followingCountResult] = await Promise.all([
    ctx.supabase
      .from("follows")
      .select("follower_id", { count: "exact", head: true })
      .eq("following_id", requestedUserId),
    ctx.supabase
      .from("follows")
      .select("following_id", { count: "exact", head: true })
      .eq("follower_id", requestedUserId),
  ]);

  if (followersCountResult.error || followingCountResult.error) {
    throw new HttpError(500, "Failed to fetch profile counts", { expose: false });
  }

  const nowIso = new Date().toISOString();
  const runPostsQuery = async (withDeletedFilter: boolean) => {
    let query = ctx.supabase
      .from("posts")
      .select(
        "id,user_id,channel,content,image_url,image_blurhash,created_at,expires_at,report_count",
        { count: "exact" },
      )
      .eq("user_id", requestedUserId)
      .eq("hidden", false)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(30);

    if (withDeletedFilter) {
      query = query.is("deleted_at", null);
    }

    return query;
  };

  let { data: posts, error: postsError, count: postsCount } = await runPostsQuery(true);
  if (postsError?.code === "42703") {
    ({ data: posts, error: postsError, count: postsCount } = await runPostsQuery(false));
  }

  if (postsError) {
    throw new HttpError(500, "Failed to fetch profile posts", { expose: false });
  }

  const { data: followBackData, error: followBackError } = await ctx.supabase
    .from("follows")
    .select("follower_id")
    .eq("follower_id", ctx.session!.userId)
    .eq("following_id", requestedUserId)
    .maybeSingle();

  if (followBackError) {
    throw new HttpError(500, "Failed to resolve follow status", { expose: false });
  }

  let savedPosts: Array<{
    id: string;
    user_id: string;
    channel: string;
    content: string;
    image_url: string | null;
    image_blurhash: string | null;
    created_at: string;
    expires_at: string;
    report_count: number;
  }> = [];

  if (isSelf) {
    const savedResult = await ctx.supabase
      .from("saved_posts")
      .select("post_id")
      .eq("user_id", ctx.session!.userId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (!savedResult.error) {
      const savedPostIds = [...new Set((savedResult.data ?? []).map((row) => row.post_id))];
      if (savedPostIds.length > 0) {
        const savedPostsResult = await ctx.supabase
          .from("posts")
          .select("id,user_id,channel,content,image_url,image_blurhash,created_at,expires_at,report_count,hidden")
          .in("id", savedPostIds)
          .eq("hidden", false)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(100);

        if (!savedPostsResult.error) {
          savedPosts = (savedPostsResult.data ?? []).map((post) => ({
            id: post.id,
            user_id: post.user_id,
            channel: post.channel,
            content: post.content,
            image_url: post.image_url,
            image_blurhash: post.image_blurhash,
            created_at: post.created_at,
            expires_at: post.expires_at,
            report_count: post.report_count,
          }));
        }
      }
    }
  } else {
    await createNotification(ctx, {
      recipientId: requestedUserId,
      actorId: ctx.session!.userId,
      type: "profile_view",
      title: "Profile viewed",
      body: `@${ctx.session!.username} viewed your profile`,
      entityType: "user",
      entityId: requestedUserId,
    });
  }

  return jsonResponse({
    user: {
      id: user.id,
      username: user.username,
      created_at: user.created_at,
      trust_score: user.trust_score,
      bio: user.bio,
      avatar_url: user.avatar_url,
    },
    stats: {
      followers: followersCountResult.count ?? 0,
      following: followingCountResult.count ?? 0,
      posts: postsCount ?? 0,
      is_following: Boolean(followBackData),
      is_self: isSelf,
    },
    posts: posts ?? [],
    saved_posts: savedPosts,
  });
}

export async function handleUpdateProfile(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);

  const body = await parseJsonBody<UpdateProfileRequestBody>(ctx.request, 12_288);
  const patch: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(body, "username")) {
    const username = sanitizeUsername(body.username);
    if (!username) {
      throw new HttpError(
        400,
        "username must be 3-20 characters (letters, numbers, underscore only)",
      );
    }
    patch.username = username;
  }

  if (Object.prototype.hasOwnProperty.call(body, "bio")) {
    const bio = sanitizeBio(body.bio, 200);
    if (body.bio !== null && body.bio !== undefined && bio === null) {
      throw new HttpError(400, "bio must be <= 200 characters");
    }
    patch.bio = bio;
  }

  if (Object.prototype.hasOwnProperty.call(body, "avatar_url")) {
    if (body.avatar_url === null || body.avatar_url === "") {
      patch.avatar_url = null;
    } else {
      const avatarUrl = sanitizeImageUrl(body.avatar_url, ctx.config.cloudinaryCloudName);
      if (!avatarUrl) {
        throw new HttpError(
          400,
          "avatar_url must be a valid Cloudinary secure URL for the configured cloud",
        );
      }
      patch.avatar_url = avatarUrl;
    }
  }

  if (Object.keys(patch).length === 0) {
    throw new HttpError(400, "No valid profile fields provided");
  }

  if (typeof patch.username === "string") {
    const existingUser = await ctx.supabase
      .from("users")
      .select("id")
      .eq("username", patch.username)
      .neq("id", ctx.session!.userId)
      .limit(1)
      .maybeSingle();

    if (existingUser.error) {
      throw new HttpError(500, "Failed to verify username", { expose: false });
    }

    if (existingUser.data) {
      throw new HttpError(409, "Username is already taken");
    }
  }

  const update = await ctx.supabase
    .from("users")
    .update(patch)
    .eq("id", ctx.session!.userId)
    .select("id,username,created_at,trust_score,bio,avatar_url")
    .single();

  let data = update.data;
  let error = update.error;

  if (error?.code === "42703") {
    const fallbackPatch = { ...patch } as Record<string, unknown>;
    delete fallbackPatch.bio;
    delete fallbackPatch.avatar_url;

    const fallbackUpdate = await ctx.supabase
      .from("users")
      .update(fallbackPatch)
      .eq("id", ctx.session!.userId)
      .select("id,username,created_at,trust_score")
      .single();

    data = fallbackUpdate.data
      ? {
          ...fallbackUpdate.data,
          bio: null,
          avatar_url: null,
        }
      : null;
    error = fallbackUpdate.error;
  }

  if (error) {
    if (error.code === "23505") {
      throw new HttpError(409, "Username is already taken");
    }
    throw new HttpError(500, "Failed to update profile", { expose: false });
  }

  return jsonResponse({
    user: data,
  });
}
