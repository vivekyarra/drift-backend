import { requireAdmin } from "../middleware/admin";
import type { AppContext } from "../types";
import {
  deleteCloudinaryImage,
  deleteCloudinaryVideo,
  extractCloudinaryPublicId,
  extractCloudinaryVideoPublicId,
} from "../utils/cloudinary";
import { HttpError } from "../utils/errors";
import { jsonResponse, parseJsonBody, parsePositiveIntParam } from "../utils/http";
import { logAsyncWarning } from "../utils/logger";
import { sanitizeUuid } from "../utils/sanitize";

interface ModerateUserRequestBody {
  user_id?: unknown;
  is_banned?: unknown;
  is_shadow_banned?: unknown;
}

interface AdminDeletePostRequestBody {
  post_id?: unknown;
}

interface AdminHidePostRequestBody {
  post_id?: unknown;
  hidden?: unknown;
}

interface AdminDeleteUserRequestBody {
  user_id?: unknown;
}

const ONLINE_WINDOW_MS = 15 * 60 * 1000;

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  return null;
}

function asCount(value: number | null): number {
  return typeof value === "number" ? value : 0;
}

function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

async function logAdminAction(
  ctx: AppContext,
  payload: {
    action: string;
    targetUserId?: string;
    targetPostId?: string;
  },
): Promise<void> {
  const insert = await ctx.supabase.from("admin_actions").insert({
    action: payload.action,
    target_user_id: payload.targetUserId ?? null,
    target_post_id: payload.targetPostId ?? null,
  });
  if (insert.error && insert.error.code !== "42P01") {
    throw new HttpError(500, "Failed to log admin action", { expose: false });
  }
}

export async function handleAdminModerateUser(ctx: AppContext): Promise<Response> {
  requireAdmin(ctx);

  const body = await parseJsonBody<ModerateUserRequestBody>(ctx.request);
  const userId = sanitizeUuid(body.user_id);
  const isBanned = asBoolean(body.is_banned);
  const isShadowBanned = asBoolean(body.is_shadow_banned);

  if (!userId) {
    throw new HttpError(400, "user_id must be a valid UUID");
  }
  if (isBanned === null && isShadowBanned === null) {
    throw new HttpError(400, "Provide is_banned and/or is_shadow_banned");
  }

  const patch: Record<string, unknown> = {};
  if (isBanned !== null) {
    patch.is_banned = isBanned;
    patch.banned_at = isBanned ? new Date().toISOString() : null;
    if (isBanned) {
      patch.is_active = false;
      patch.deactivated_at = new Date().toISOString();
    }
  }
  if (isShadowBanned !== null) {
    patch.is_shadow_banned = isShadowBanned;
  }

  const update = await ctx.supabase.from("users").update(patch).eq("id", userId);
  if (update.error && update.error.code !== "42703") {
    throw new HttpError(500, "Failed to update user moderation", { expose: false });
  }

  if (isBanned === true) {
    await ctx.supabase.from("sessions").delete().eq("user_id", userId);
  }

  await logAdminAction(ctx, {
    action: "moderate_user",
    targetUserId: userId,
  });

  return jsonResponse({
    success: true,
    user_id: userId,
    is_banned: isBanned,
    is_shadow_banned: isShadowBanned,
  });
}

export async function handleAdminDeletePost(ctx: AppContext): Promise<Response> {
  requireAdmin(ctx);

  const body = await parseJsonBody<AdminDeletePostRequestBody>(ctx.request);
  const postId = sanitizeUuid(body.post_id);
  if (!postId) {
    throw new HttpError(400, "post_id must be a valid UUID");
  }

  const postLookup = await ctx.supabase
    .from("posts")
    .select("id,image_url,image_public_id,video_url,video_public_id")
    .eq("id", postId)
    .maybeSingle();

  if (postLookup.error && postLookup.error.code !== "42703") {
    throw new HttpError(500, "Failed to fetch post", { expose: false });
  }

  let postData = postLookup.data;
  if (postLookup.error?.code === "42703") {
    const fallbackLookupWithVideo = await ctx.supabase
      .from("posts")
      .select("id,image_url,video_url")
      .eq("id", postId)
      .maybeSingle();

    if (!fallbackLookupWithVideo.error) {
      postData = fallbackLookupWithVideo.data
        ? {
            ...fallbackLookupWithVideo.data,
            image_public_id: null,
            video_public_id: null,
          }
        : null;
    } else if (fallbackLookupWithVideo.error.code === "42703") {
      const fallbackLookup = await ctx.supabase
        .from("posts")
        .select("id,image_url")
        .eq("id", postId)
        .maybeSingle();

      if (fallbackLookup.error) {
        throw new HttpError(500, "Failed to fetch post", { expose: false });
      }

      postData = fallbackLookup.data
        ? {
            ...fallbackLookup.data,
            image_public_id: null,
            video_url: null,
            video_public_id: null,
          }
        : null;
    } else {
      throw new HttpError(500, "Failed to fetch post", { expose: false });
    }
  }

  if (!postData) {
    throw new HttpError(404, "Post not found");
  }

  const imagePublicId =
    postData.image_public_id ??
    (postData.image_url
      ? extractCloudinaryPublicId(postData.image_url, ctx.config.cloudinaryCloudName)
      : null);
  const videoPublicId =
    postData.video_public_id ??
    (postData.video_url
      ? extractCloudinaryVideoPublicId(postData.video_url, ctx.config.cloudinaryCloudName)
      : null);

  if (imagePublicId || videoPublicId) {
    try {
      if (imagePublicId) {
        await deleteCloudinaryImage(ctx.config, imagePublicId);
      }
      if (videoPublicId) {
        await deleteCloudinaryVideo(ctx.config, videoPublicId);
      }
    } catch {
      logAsyncWarning(
        ctx,
        "admin.post.delete.cloudinary_cleanup_failed",
        "Cloudinary cleanup failed during admin post deletion",
      );
    }
  }

  await cleanupPostDependencies(ctx, postId);

  const deletion = await ctx.supabase
    .from("posts")
    .delete()
    .eq("id", postId)
    .select("id")
    .maybeSingle();

  if (deletion.error) {
    throw new HttpError(500, "Failed to remove post", { expose: false });
  }
  if (!deletion.data) {
    throw new HttpError(404, "Post not found");
  }

  await logAdminAction(ctx, {
    action: `delete_post:${postId}`,
  });

  return jsonResponse({
    success: true,
    post_id: postId,
  });
}

async function cleanupPostDependencies(ctx: AppContext, postId: string): Promise<void> {
  const results = await Promise.all([
    ctx.supabase.from("comments").delete().eq("post_id", postId),
    ctx.supabase.from("post_reactions").delete().eq("post_id", postId),
    ctx.supabase.from("saved_posts").delete().eq("post_id", postId),
    ctx.supabase.from("reports").delete().eq("content_type", "post").eq("content_id", postId),
    ctx.supabase.from("admin_actions").delete().eq("target_post_id", postId),
    ctx.supabase.from("notifications").delete().eq("entity_type", "post").eq("entity_id", postId),
  ]);

  for (const result of results) {
    if (result.error && result.error.code !== "42P01" && result.error.code !== "42703") {
      throw new HttpError(500, "Failed to remove post dependencies", { expose: false });
    }
  }
}

export async function handleAdminHidePost(ctx: AppContext): Promise<Response> {
  requireAdmin(ctx);

  const body = await parseJsonBody<AdminHidePostRequestBody>(ctx.request);
  const postId = sanitizeUuid(body.post_id);
  const hidden = asBoolean(body.hidden) ?? true;

  if (!postId) {
    throw new HttpError(400, "post_id must be a valid UUID");
  }

  const update = await ctx.supabase
    .from("posts")
    .update({
      hidden,
    })
    .eq("id", postId)
    .select("id")
    .limit(1);

  if (update.error) {
    throw new HttpError(500, "Failed to update post visibility", { expose: false });
  }
  if (!update.data || update.data.length === 0) {
    throw new HttpError(404, "Post not found");
  }

  await logAdminAction(ctx, {
    action: hidden ? "hide_post" : "unhide_post",
    targetPostId: postId,
  });

  return jsonResponse({
    success: true,
    post_id: postId,
    hidden,
  });
}

export async function handleAdminDeleteUser(ctx: AppContext): Promise<Response> {
  requireAdmin(ctx);

  const body = await parseJsonBody<AdminDeleteUserRequestBody>(ctx.request);
  const userId = sanitizeUuid(body.user_id);
  if (!userId) {
    throw new HttpError(400, "user_id must be a valid UUID");
  }

  const deletion = await ctx.supabase
    .from("users")
    .delete()
    .eq("id", userId)
    .select("id")
    .limit(1);

  if (deletion.error) {
    throw new HttpError(500, "Failed to delete user", { expose: false });
  }
  if (!deletion.data || deletion.data.length === 0) {
    throw new HttpError(404, "User not found");
  }

  await logAdminAction(ctx, {
    action: `delete_user:${userId}`,
  });

  return jsonResponse({
    success: true,
    user_id: userId,
  });
}

export async function handleAdminOverview(ctx: AppContext): Promise<Response> {
  requireAdmin(ctx);

  const nowMs = Date.now();
  const onlineThresholdIso = new Date(nowMs - ONLINE_WINDOW_MS).toISOString();

  const [
    totalUsersResult,
    activeUsersResult,
    bannedUsersResult,
    totalPostsResult,
    hiddenPostsResult,
    totalReportsResult,
    recentSessionsResult,
  ] = await Promise.all([
    ctx.supabase.from("users").select("id", { count: "exact", head: true }),
    ctx.supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    ctx.supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("is_banned", true),
    ctx.supabase.from("posts").select("id", { count: "exact", head: true }),
    ctx.supabase.from("posts").select("id", { count: "exact", head: true }).eq("hidden", true),
    ctx.supabase.from("reports").select("id", { count: "exact", head: true }),
    ctx.supabase
      .from("sessions")
      .select("user_id,last_active,expires_at")
      .gte("last_active", onlineThresholdIso)
      .limit(5_000),
  ]);

  if (
    totalUsersResult.error ||
    activeUsersResult.error ||
    bannedUsersResult.error ||
    totalPostsResult.error ||
    hiddenPostsResult.error ||
    totalReportsResult.error ||
    recentSessionsResult.error
  ) {
    throw new HttpError(500, "Failed to fetch admin overview", { expose: false });
  }

  const onlineUsers = new Set(
    (recentSessionsResult.data ?? [])
      .filter((session) => {
        if (!session.expires_at) {
          return true;
        }
        const expiresMs = Date.parse(session.expires_at);
        return Number.isFinite(expiresMs) && expiresMs > nowMs;
      })
      .map((session) => session.user_id),
  );

  return jsonResponse({
    stats: {
      total_users: asCount(totalUsersResult.count),
      active_users: asCount(activeUsersResult.count),
      banned_users: asCount(bannedUsersResult.count),
      online_users: onlineUsers.size,
      total_posts: asCount(totalPostsResult.count),
      hidden_posts: asCount(hiddenPostsResult.count),
      total_reports: asCount(totalReportsResult.count),
    },
  });
}

export async function handleAdminUsers(ctx: AppContext): Promise<Response> {
  requireAdmin(ctx);

  const url = new URL(ctx.request.url);
  const limit = parsePositiveIntParam(url.searchParams.get("limit"), {
    min: 1,
    max: 200,
    fallback: 50,
    invalidMessage: "limit must be between 1 and 200",
  });
  const queryText = (url.searchParams.get("q") ?? "").trim();

  let query = ctx.supabase
    .from("users")
    .select(
      "id,username,recovery_key_hash,created_at,trust_score,is_active,is_banned,is_shadow_banned,bio,avatar_url",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (queryText) {
    query = query.ilike("username", `%${escapeLikePattern(queryText)}%`);
  }

  const { data, error } = await query;
  if (error) {
    throw new HttpError(500, "Failed to fetch users", { expose: false });
  }

  return jsonResponse({
    users: data ?? [],
  });
}

export async function handleAdminPosts(ctx: AppContext): Promise<Response> {
  requireAdmin(ctx);

  const url = new URL(ctx.request.url);
  const limit = parsePositiveIntParam(url.searchParams.get("limit"), {
    min: 1,
    max: 200,
    fallback: 50,
    invalidMessage: "limit must be between 1 and 200",
  });
  const queryText = (url.searchParams.get("q") ?? "").trim();
  const includeHidden = url.searchParams.get("include_hidden") !== "false";

  const runPostsQuery = async (selectClause: string) => {
    let query = ctx.supabase
      .from("posts")
      .select(selectClause)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!includeHidden) {
      query = query.eq("hidden", false);
    }
    if (queryText) {
      query = query.ilike("content", `%${escapeLikePattern(queryText)}%`);
    }

    return query;
  };

  let { data, error } = await runPostsQuery(
    "id,user_id,channel,content,image_url,video_url,created_at,expires_at,hidden,report_count,deleted_at",
  );
  if (error?.code === "42703") {
    ({ data, error } = await runPostsQuery(
      "id,user_id,channel,content,image_url,video_url,created_at,expires_at,hidden,report_count",
    ));
  }
  if (error?.code === "42703") {
    ({ data, error } = await runPostsQuery(
      "id,user_id,channel,content,image_url,created_at,expires_at,hidden,report_count",
    ));
  }

  if (error) {
    throw new HttpError(500, "Failed to fetch posts", { expose: false });
  }

  return jsonResponse({
    posts: data ?? [],
  });
}

export async function handleAdminReports(ctx: AppContext): Promise<Response> {
  requireAdmin(ctx);

  const url = new URL(ctx.request.url);
  const limit = parsePositiveIntParam(url.searchParams.get("limit"), {
    min: 1,
    max: 200,
    fallback: 50,
    invalidMessage: "limit must be between 1 and 200",
  });
  const contentType = url.searchParams.get("content_type")?.trim().toLowerCase();
  if (contentType && contentType !== "post" && contentType !== "comment") {
    throw new HttpError(400, "content_type must be post or comment");
  }

  let query = ctx.supabase
    .from("reports")
    .select("id,content_type,content_id,reporter_id,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (contentType) {
    query = query.eq("content_type", contentType);
  }

  const { data, error } = await query;
  if (error) {
    throw new HttpError(500, "Failed to fetch reports", { expose: false });
  }

  return jsonResponse({
    reports: data ?? [],
  });
}
