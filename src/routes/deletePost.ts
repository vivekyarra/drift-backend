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
}

async function getPostForDeletion(
  ctx: AppContext,
  postId: string,
): Promise<PostDeleteRecord | null> {
  const primarySelect = await ctx.supabase
    .from("posts")
    .select("id,user_id,image_url,image_public_id")
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
  };
}

async function hardDeletePost(
  ctx: AppContext,
  postId: string,
  ownerUserId: string,
): Promise<void> {
  const deletion = await ctx.supabase
    .from("posts")
    .delete()
    .eq("id", postId)
    .eq("user_id", ownerUserId)
    .select("id")
    .maybeSingle();

  if (deletion.error) {
    throw new HttpError(500, "Failed to delete post", { expose: false });
  }

  if (!deletion.data) {
    throw new HttpError(404, "Post not found");
  }

  // Best-effort cleanup for tables that may not have FK constraints.
  const reportsCleanup = await ctx.supabase
    .from("reports")
    .delete()
    .eq("content_type", "post")
    .eq("content_id", postId);

  if (reportsCleanup.error && reportsCleanup.error.code !== "42P01") {
    throw new HttpError(500, "Failed to finalize post deletion", { expose: false });
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

  const imagePublicId =
    post.image_public_id ??
    (post.image_url
      ? extractCloudinaryPublicId(post.image_url, ctx.config.cloudinaryCloudName)
      : null);

  if (imagePublicId) {
    await deleteCloudinaryImage(ctx.config, imagePublicId);
  }

  await hardDeletePost(ctx, postId, ctx.session!.userId);

  return jsonResponse({ success: true });
}
