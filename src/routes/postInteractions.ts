import { requireSession } from "../middleware/auth";
import { enforceActionLimit } from "../middleware/abuseGuard";
import type { AppContext } from "../types";
import { HttpError } from "../utils/errors";
import { jsonResponse, parseIsoTimestampParam, parseJsonBody } from "../utils/http";
import { createNotification } from "../utils/notifications";
import { fetchPostEngagement } from "../utils/postEngagement";
import { sanitizeContent, sanitizeEmoji, sanitizeUuid } from "../utils/sanitize";

interface ReactionBody {
  reaction?: unknown;
  emoji?: unknown;
}

interface CommentBody {
  content?: unknown;
}

type ReactionType = "like" | "dislike" | "emoji";

function parseReactionType(value: unknown): ReactionType | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "like" || normalized === "dislike" || normalized === "emoji") {
    return normalized;
  }
  return null;
}

async function getPostOwner(
  ctx: AppContext,
  postId: string,
): Promise<{ id: string; user_id: string; created_at: string } | null> {
  const query = await ctx.supabase
    .from("posts")
    .select("id,user_id,created_at")
    .eq("id", postId)
    .maybeSingle();

  if (query.error) {
    throw new HttpError(500, "Failed to load post", { expose: false });
  }

  return query.data;
}

export async function handleGetPostById(
  ctx: AppContext,
  rawPostId: string,
): Promise<Response> {
  await requireSession(ctx);

  const postId = sanitizeUuid(rawPostId);
  if (!postId) {
    throw new HttpError(400, "Invalid post id");
  }

  const runQuery = async (withDeletedFilter: boolean) => {
    const baseQuery = ctx.supabase
      .from("posts")
      .select(
        "id,user_id,channel,content,image_url,video_url,image_blurhash,created_at,expires_at,hidden",
      )
      .eq("id", postId)
      .eq("hidden", false)
      .gt("expires_at", new Date().toISOString());

    const query = withDeletedFilter
      ? baseQuery.is("deleted_at", null)
      : baseQuery;

    return query.maybeSingle();
  };

  let { data: post, error } = await runQuery(true);
  if (error?.code === "42703") {
    ({ data: post, error } = await runQuery(false));
  }
  if (error) {
    throw new HttpError(500, "Failed to load post", { expose: false });
  }
  if (!post) {
    throw new HttpError(404, "Post not found");
  }

  const [authorResult, engagementMap] = await Promise.all([
    ctx.supabase.from("users").select("id,username").eq("id", post.user_id).maybeSingle(),
    fetchPostEngagement(ctx, [post.id], ctx.session!.userId),
  ]);

  if (authorResult.error) {
    throw new HttpError(500, "Failed to load post author", { expose: false });
  }

  const engagement = engagementMap.get(post.id);
  return jsonResponse({
    post: {
      ...post,
      username: authorResult.data?.username ?? "unknown",
      engagement: engagement ?? null,
    },
  });
}

export async function handleReactToPost(
  ctx: AppContext,
  rawPostId: string,
): Promise<Response> {
  await requireSession(ctx);
  enforceActionLimit({
    actorKey: ctx.session!.userId,
    action: "post.react",
    limit: 60,
    windowMs: 60_000,
    minIntervalMs: 180,
    errorCode: "REACTION_SPAM",
  });

  const postId = sanitizeUuid(rawPostId);
  if (!postId) {
    throw new HttpError(400, "Invalid post id");
  }

  const body = await parseJsonBody<ReactionBody>(ctx.request);
  const reactionType = parseReactionType(body.reaction);
  if (!reactionType) {
    throw new HttpError(400, "reaction must be like, dislike, or emoji");
  }

  const emoji = reactionType === "emoji" ? sanitizeEmoji(body.emoji) : null;
  if (reactionType === "emoji" && !emoji) {
    throw new HttpError(400, "emoji reaction requires a valid emoji");
  }

  const postOwner = await getPostOwner(ctx, postId);
  if (!postOwner) {
    throw new HttpError(404, "Post not found");
  }

  const { error } = await ctx.supabase.from("post_reactions").upsert(
    {
      post_id: postId,
      user_id: ctx.session!.userId,
      reaction_type: reactionType,
      emoji,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "post_id,user_id",
    },
  );

  if (error) {
    if (error.code === "42P01") {
      throw new HttpError(500, "Reactions migration missing", { expose: false });
    }
    throw new HttpError(500, "Failed to save reaction", { expose: false });
  }

  await createNotification(ctx, {
    recipientId: postOwner.user_id,
    actorId: ctx.session!.userId,
    type: reactionType === "like" ? "post_like" : reactionType === "dislike" ? "post_dislike" : "post_emoji",
    title:
      reactionType === "like"
        ? "New like"
        : reactionType === "dislike"
          ? "New dislike"
          : "New reaction",
    body:
      reactionType === "emoji"
        ? `@${ctx.session!.username} reacted ${emoji}`
        : `@${ctx.session!.username} reacted to your post`,
    entityType: "post",
    entityId: postId,
  });

  const engagement = (await fetchPostEngagement(ctx, [postId], ctx.session!.userId)).get(postId);
  return jsonResponse({
    success: true,
    engagement: engagement ?? null,
  });
}

export async function handleClearPostReaction(
  ctx: AppContext,
  rawPostId: string,
): Promise<Response> {
  await requireSession(ctx);
  const postId = sanitizeUuid(rawPostId);
  if (!postId) {
    throw new HttpError(400, "Invalid post id");
  }

  const { error } = await ctx.supabase
    .from("post_reactions")
    .delete()
    .eq("post_id", postId)
    .eq("user_id", ctx.session!.userId);

  if (error && error.code !== "42P01") {
    throw new HttpError(500, "Failed to clear reaction", { expose: false });
  }

  const engagement = (await fetchPostEngagement(ctx, [postId], ctx.session!.userId)).get(postId);
  return jsonResponse({
    success: true,
    engagement: engagement ?? null,
  });
}

export async function handleGetPostComments(
  ctx: AppContext,
  rawPostId: string,
): Promise<Response> {
  await requireSession(ctx);

  const postId = sanitizeUuid(rawPostId);
  if (!postId) {
    throw new HttpError(400, "Invalid post id");
  }

  const url = new URL(ctx.request.url);
  const cursor = parseIsoTimestampParam(url.searchParams.get("cursor"), "Invalid cursor");

  let query = ctx.supabase
    .from("comments")
    .select("id,post_id,user_id,content,created_at")
    .eq("post_id", postId)
    .eq("hidden", false)
    .order("created_at", { ascending: false })
    .limit(30);

  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const { data: comments, error } = await query;
  if (error) {
    throw new HttpError(500, "Failed to fetch comments", { expose: false });
  }

  const rows = comments ?? [];
  const userIds = [...new Set(rows.map((comment) => comment.user_id))];

  let userMap = new Map<string, string>();
  if (userIds.length > 0) {
    const usersResult = await ctx.supabase
      .from("users")
      .select("id,username")
      .in("id", userIds);

    if (usersResult.error) {
      throw new HttpError(500, "Failed to resolve comment users", { expose: false });
    }

    userMap = new Map((usersResult.data ?? []).map((user) => [user.id, user.username]));
  }

  const nextCursor = rows.length > 0 ? rows[rows.length - 1].created_at : null;
  return jsonResponse({
    comments: rows.map((comment) => ({
      ...comment,
      username: userMap.get(comment.user_id) ?? "unknown",
    })),
    nextCursor,
  });
}

export async function handleCreatePostComment(
  ctx: AppContext,
  rawPostId: string,
): Promise<Response> {
  await requireSession(ctx);
  enforceActionLimit({
    actorKey: ctx.session!.userId,
    action: "post.comment",
    limit: 40,
    windowMs: 60_000,
    minIntervalMs: 250,
    errorCode: "COMMENT_SPAM",
  });

  const postId = sanitizeUuid(rawPostId);
  if (!postId) {
    throw new HttpError(400, "Invalid post id");
  }

  const body = await parseJsonBody<CommentBody>(ctx.request);
  const content = sanitizeContent(body.content, 500);
  if (!content) {
    throw new HttpError(400, "Comment must be 1-500 characters");
  }

  const postOwner = await getPostOwner(ctx, postId);
  if (!postOwner) {
    throw new HttpError(404, "Post not found");
  }

  const insert = await ctx.supabase
    .from("comments")
    .insert({
      post_id: postId,
      user_id: ctx.session!.userId,
      content,
    })
    .select("id,post_id,user_id,content,created_at")
    .single();

  if (insert.error) {
    throw new HttpError(500, "Failed to add comment", { expose: false });
  }

  await createNotification(ctx, {
    recipientId: postOwner.user_id,
    actorId: ctx.session!.userId,
    type: "post_comment",
    title: "New comment",
    body: `@${ctx.session!.username} commented on your post`,
    entityType: "post",
    entityId: postId,
  });

  return jsonResponse(
    {
      comment: insert.data,
    },
    201,
  );
}

export async function handleSavePost(
  ctx: AppContext,
  rawPostId: string,
): Promise<Response> {
  await requireSession(ctx);
  const postId = sanitizeUuid(rawPostId);
  if (!postId) {
    throw new HttpError(400, "Invalid post id");
  }

  const postOwner = await getPostOwner(ctx, postId);
  if (!postOwner) {
    throw new HttpError(404, "Post not found");
  }

  const { error } = await ctx.supabase.from("saved_posts").upsert(
    {
      user_id: ctx.session!.userId,
      post_id: postId,
    },
    {
      onConflict: "user_id,post_id",
      ignoreDuplicates: true,
    },
  );

  if (error && error.code !== "42P01") {
    throw new HttpError(500, "Failed to save post", { expose: false });
  }

  await createNotification(ctx, {
    recipientId: postOwner.user_id,
    actorId: ctx.session!.userId,
    type: "post_save",
    title: "Post saved",
    body: `@${ctx.session!.username} saved your post`,
    entityType: "post",
    entityId: postId,
  });

  const engagement = (await fetchPostEngagement(ctx, [postId], ctx.session!.userId)).get(postId);
  return jsonResponse({
    success: true,
    engagement: engagement ?? null,
  });
}

export async function handleUnsavePost(
  ctx: AppContext,
  rawPostId: string,
): Promise<Response> {
  await requireSession(ctx);
  const postId = sanitizeUuid(rawPostId);
  if (!postId) {
    throw new HttpError(400, "Invalid post id");
  }

  const { error } = await ctx.supabase
    .from("saved_posts")
    .delete()
    .eq("user_id", ctx.session!.userId)
    .eq("post_id", postId);

  if (error && error.code !== "42P01") {
    throw new HttpError(500, "Failed to unsave post", { expose: false });
  }

  const engagement = (await fetchPostEngagement(ctx, [postId], ctx.session!.userId)).get(postId);
  return jsonResponse({
    success: true,
    engagement: engagement ?? null,
  });
}
