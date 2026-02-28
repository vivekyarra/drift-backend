import { requireSession } from "../middleware/auth";
import { enforceActionLimit } from "../middleware/abuseGuard";
import type { AppContext } from "../types";
import {
  deleteCloudinaryImage,
  extractCloudinaryPublicId,
} from "../utils/cloudinary";
import { HttpError } from "../utils/errors";
import { jsonResponse, parseJsonBody } from "../utils/http";
import { sanitizeUuid } from "../utils/sanitize";

interface DeletePostRequestBody {
  post_id?: unknown;
}

interface PostDeleteRecord {
  id: string;
  user_id: string;
  image_url: string | null;
  image_public_id: string | null;
  deleted_at: string | null;
}

async function getPostForDeletion(
  ctx: AppContext,
  postId: string,
): Promise<PostDeleteRecord | null> {
  const primarySelect = await ctx.supabase
    .from("posts")
    .select("id,user_id,image_url,image_public_id,deleted_at")
    .eq("id", postId)
    .maybeSingle();

  if (!primarySelect.error) {
    return primarySelect.data;
  }

  if (primarySelect.error.code !== "42703") {
    throw new HttpError(500, "Failed to fetch post", { expose: false });
  }

  const fallbackSelect = await ctx.supabase
    .from("posts")
    .select("id,user_id,image_url")
    .eq("id", postId)
    .maybeSingle();

  if (fallbackSelect.error) {
    throw new HttpError(500, "Failed to fetch post", { expose: false });
  }

  if (!fallbackSelect.data) {
    return null;
  }

  return {
    ...fallbackSelect.data,
    image_public_id: null,
    deleted_at: null,
  };
}

async function softDeletePost(ctx: AppContext, postId: string): Promise<void> {
  const deletedAt = new Date().toISOString();
  const primaryUpdate = await ctx.supabase
    .from("posts")
    .update({
      hidden: true,
      deleted_at: deletedAt,
      content: "[deleted]",
      image_url: null,
      image_blurhash: null,
      image_public_id: null,
    })
    .eq("id", postId);

  if (!primaryUpdate.error) {
    return;
  }

  if (primaryUpdate.error.code !== "42703") {
    throw new HttpError(500, "Failed to delete post", { expose: false });
  }

  const fallbackUpdate = await ctx.supabase
    .from("posts")
    .update({
      hidden: true,
      content: "[deleted]",
      image_url: null,
      image_blurhash: null,
    })
    .eq("id", postId);

  if (!fallbackUpdate.error) {
    return;
  }

  if (fallbackUpdate.error.code !== "42703") {
    throw new HttpError(500, "Failed to delete post", { expose: false });
  }

  const minimalFallback = await ctx.supabase
    .from("posts")
    .update({
      hidden: true,
      content: "[deleted]",
    })
    .eq("id", postId);

  if (minimalFallback.error) {
    throw new HttpError(500, "Failed to delete post", { expose: false });
  }
}

export async function handleDeletePost(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);
  enforceActionLimit({
    actorKey: ctx.session!.userId,
    action: "post.delete",
    limit: 20,
    windowMs: 60_000,
    minIntervalMs: 300,
    errorCode: "POST_DELETE_SPAM",
  });

  const body = await parseJsonBody<DeletePostRequestBody>(ctx.request);
  const postId = sanitizeUuid(body.post_id);
  if (!postId) {
    throw new HttpError(400, "post_id must be a valid UUID");
  }

  const post = await getPostForDeletion(ctx, postId);
  if (!post) {
    throw new HttpError(404, "Post not found");
  }

  if (post.user_id !== ctx.session!.userId) {
    throw new HttpError(403, "Forbidden");
  }

  if (post.deleted_at) {
    return jsonResponse({ success: true, already_deleted: true });
  }

  const imagePublicId =
    post.image_public_id ??
    (post.image_url
      ? extractCloudinaryPublicId(post.image_url, ctx.config.cloudinaryCloudName)
      : null);

  if (imagePublicId) {
    await deleteCloudinaryImage(ctx.config, imagePublicId);
  }

  await softDeletePost(ctx, postId);

  return jsonResponse({ success: true });
}
