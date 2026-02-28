import { requireSession } from "../middleware/auth";
import type { AppContext } from "../types";
import { buildCloudinaryUploadSignature } from "../utils/cloudinary";
import { HttpError } from "../utils/errors";
import { jsonResponse } from "../utils/http";

export async function handleSignMediaUpload(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);

  if (!ctx.config.cloudinaryApiKey || !ctx.config.cloudinaryApiSecret) {
    throw new HttpError(503, "Media upload signing is unavailable");
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "voidvault/posts";
  const signature = await buildCloudinaryUploadSignature(ctx.config, {
    folder,
    timestamp,
  });

  return jsonResponse({
    cloud_name: ctx.config.cloudinaryCloudName,
    api_key: ctx.config.cloudinaryApiKey,
    timestamp,
    folder,
    signature,
  });
}
