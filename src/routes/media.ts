import { requireSession } from "../middleware/auth";
import type { AppContext } from "../types";
import { buildCloudinaryUploadSignature } from "../utils/cloudinary";
import { HttpError } from "../utils/errors";
import { jsonResponse, parseJsonBody } from "../utils/http";

interface SignMediaUploadRequestBody {
  purpose?: unknown;
}

export async function handleSignMediaUpload(ctx: AppContext): Promise<Response> {
  await requireSession(ctx);

  if (!ctx.config.cloudinaryApiKey || !ctx.config.cloudinaryApiSecret) {
    throw new HttpError(503, "Media upload signing is unavailable");
  }

  let purpose: "post" | "profile" = "post";
  const contentType = ctx.request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const body = await parseJsonBody<SignMediaUploadRequestBody>(ctx.request, 1_024);
    if (body.purpose !== undefined) {
      if (body.purpose !== "post" && body.purpose !== "profile") {
        throw new HttpError(400, "purpose must be post or profile");
      }
      purpose = body.purpose;
    }
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = purpose === "profile" ? "voidvault/avatars" : "voidvault/posts";
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
