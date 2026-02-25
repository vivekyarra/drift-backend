import { requireSession } from "../middleware/auth";
import type { AppContext } from "../types";
import { HttpError } from "../utils/errors";
import { jsonResponse, parseJsonBody } from "../utils/http";
import {
  sanitizeChannel,
  sanitizeContent,
  sanitizeImageUrl,
} from "../utils/sanitize";

interface CreatePostRequestBody {
  channel?: unknown;
  content?: unknown;
  image_url?: unknown;
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

  const body = await parseJsonBody<CreatePostRequestBody>(ctx.request);
  const channel = sanitizeChannel(body.channel);
  const content = sanitizeContent(body.content, 500);
  const hasImageUrlField = Object.prototype.hasOwnProperty.call(body, "image_url");
  const hasImageBlurhashField = Object.prototype.hasOwnProperty.call(
    body,
    "image_blurhash",
  );

  const imageUrl = hasImageUrlField ? sanitizeImageUrl(body.image_url) : null;
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
    throw new HttpError(400, "image_url must be a valid HTTPS URL");
  }

  if (hasImageBlurhashField && !imageBlurhash) {
    throw new HttpError(400, "image_blurhash must be a non-empty string <= 200 chars");
  }

  const expiresAt = new Date(Date.now() + FIFTEEN_DAYS_MS).toISOString();
  const { data: post, error: insertError } = await ctx.supabase
    .from("posts")
    .insert({
      user_id: ctx.session!.userId,
      channel,
      content,
      image_url: imageUrl,
      image_blurhash: imageBlurhash,
      expires_at: expiresAt,
    })
    .select(
      "id,user_id,channel,content,image_url,image_blurhash,created_at,expires_at,trust_weight,report_count",
    )
    .single();

  if (insertError) {
    throw new HttpError(500, "Failed to create post", { expose: false });
  }

  return jsonResponse({ post }, 201);
}
