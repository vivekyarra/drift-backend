import { requireSession } from "../middleware/auth";
import { enforceActionLimit } from "../middleware/abuseGuard";
import type { AppContext } from "../types";
import {
  extractCloudinaryPublicId,
  extractCloudinaryVideoPublicId,
} from "../utils/cloudinary";
import { HttpError } from "../utils/errors";
import { jsonResponse, parseJsonBody } from "../utils/http";
import {
  sanitizeChannel,
  sanitizeContent,
  sanitizeImageUrl,
  sanitizeVideoUrl,
} from "../utils/sanitize";

interface CreatePostRequestBody {
  channel?: unknown;
  content?: unknown;
  image_url?: unknown;
  video_url?: unknown;
  image_blurhash?: unknown;
}

const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;

function sanitizeImageBlurhash(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) {
    return null;
  }

  return trimmed;
}

export async function handleCreatePost(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);
  enforceActionLimit({
    actorKey: ctx.session!.userId,
    action: "post.create",
    limit: 8,
    windowMs: 60_000,
    minIntervalMs: 3_000,
    errorCode: "POST_SPAM",
  });

  const body = await parseJsonBody<CreatePostRequestBody>(ctx.request, 12_288);
  const channel = sanitizeChannel(body.channel);
  const content = sanitizeContent(body.content, 500);
  const hasImageUrlField = Object.prototype.hasOwnProperty.call(body, "image_url");
  const hasVideoUrlField = Object.prototype.hasOwnProperty.call(body, "video_url");
  const hasImageBlurhashField = Object.prototype.hasOwnProperty.call(
    body,
    "image_blurhash",
  );

  const imageUrl = hasImageUrlField
    ? sanitizeImageUrl(body.image_url, ctx.config.cloudinaryCloudName)
    : null;
  const videoUrl = hasVideoUrlField
    ? sanitizeVideoUrl(body.video_url, ctx.config.cloudinaryCloudName)
    : null;
  const imageBlurhash = hasImageBlurhashField
    ? sanitizeImageBlurhash(body.image_blurhash)
    : null;

  if (!channel) {
    throw new HttpError(
      400,
      "Channel must be 1-32 characters (letters, numbers, dash, underscore only)",
    );
  }

  if (!content) {
    throw new HttpError(400, "Content must be between 1 and 500 characters");
  }

  if (hasImageUrlField && !imageUrl) {
    throw new HttpError(
      400,
      "image_url must be a valid Cloudinary secure URL for the configured cloud",
    );
  }

  if (hasVideoUrlField && !videoUrl) {
    throw new HttpError(
      400,
      "video_url must be a valid Cloudinary secure video URL for the configured cloud",
    );
  }

  if (imageUrl && videoUrl) {
    throw new HttpError(400, "Provide only one media type per post");
  }

  if (hasImageBlurhashField && !imageBlurhash) {
    throw new HttpError(400, "image_blurhash must be a non-empty string <= 200 chars");
  }

  const imagePublicId = imageUrl
    ? extractCloudinaryPublicId(imageUrl, ctx.config.cloudinaryCloudName)
    : null;
  const videoPublicId = videoUrl
    ? extractCloudinaryVideoPublicId(videoUrl, ctx.config.cloudinaryCloudName)
    : null;

  if (imageUrl && !imagePublicId) {
    throw new HttpError(400, "Unable to derive Cloudinary public_id from image_url");
  }
  if (videoUrl && !videoPublicId) {
    throw new HttpError(400, "Unable to derive Cloudinary public_id from video_url");
  }

  const expiresAt = new Date(Date.now() + FIFTEEN_DAYS_MS).toISOString();
  const primaryInsert = await ctx.supabase
    .from("posts")
    .insert({
      user_id: ctx.session!.userId,
      channel,
      content,
      image_url: imageUrl,
      video_url: videoUrl,
      image_blurhash: imageBlurhash,
      image_public_id: imagePublicId,
      video_public_id: videoPublicId,
      expires_at: expiresAt,
      hidden: ctx.session!.isShadowBanned,
    })
    .select(
      "id,user_id,channel,content,image_url,video_url,image_blurhash,image_public_id,video_public_id,created_at,expires_at,trust_weight,report_count",
    )
    .single();

  if (!primaryInsert.error) {
    return jsonResponse({ post: primaryInsert.data }, 201);
  }

  if (primaryInsert.error.code === "42703") {
    const fallbackInsert = await ctx.supabase
      .from("posts")
      .insert({
        user_id: ctx.session!.userId,
        channel,
        content,
        image_url: imageUrl,
        video_url: videoUrl,
        image_blurhash: imageBlurhash,
        expires_at: expiresAt,
        hidden: ctx.session!.isShadowBanned,
      })
      .select(
        "id,user_id,channel,content,image_url,video_url,image_blurhash,created_at,expires_at,trust_weight,report_count",
      )
      .single();

    if (!fallbackInsert.error) {
      return jsonResponse({ post: fallbackInsert.data }, 201);
    }
  }

  if (primaryInsert.error) {
    throw new HttpError(500, "Failed to create post", { expose: false });
  }
  throw new HttpError(500, "Failed to create post", { expose: false });
}
