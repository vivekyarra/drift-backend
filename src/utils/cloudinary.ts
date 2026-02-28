import type { AppConfig } from "../types";
import { HttpError } from "./errors";

const textEncoder = new TextEncoder();
const VERSION_SEGMENT_REGEX = /^v\d+$/;

function stripFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) {
    return filename;
  }
  return filename.slice(0, lastDot);
}

async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", textEncoder.encode(input));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildCloudinaryUploadSignature(
  config: AppConfig,
  params: {
    folder?: string | null;
    publicId?: string | null;
    timestamp: number;
  },
): Promise<string> {
  if (!config.cloudinaryApiSecret) {
    throw new HttpError(500, "Cloudinary signing is not configured", {
      expose: false,
    });
  }

  const parts: string[] = [];
  if (params.folder) {
    parts.push(`folder=${params.folder}`);
  }
  if (params.publicId) {
    parts.push(`public_id=${params.publicId}`);
  }
  parts.push(`timestamp=${params.timestamp}`);
  const payload = `${parts.join("&")}${config.cloudinaryApiSecret}`;
  return sha1Hex(payload);
}

export function extractCloudinaryPublicId(
  imageUrl: string,
  cloudinaryCloudName: string,
): string | null {
  try {
    const url = new URL(imageUrl);
    if (url.protocol !== "https:") {
      return null;
    }

    if (url.hostname.toLowerCase() !== "res.cloudinary.com") {
      return null;
    }

    const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
    if (segments.length < 4) {
      return null;
    }

    if (segments[0].toLowerCase() !== cloudinaryCloudName.toLowerCase()) {
      return null;
    }

    if (segments[1].toLowerCase() !== "image") {
      return null;
    }

    let assetSegments = segments.slice(3);
    const versionIndex = assetSegments.findIndex((segment) =>
      VERSION_SEGMENT_REGEX.test(segment),
    );
    if (versionIndex >= 0) {
      assetSegments = assetSegments.slice(versionIndex + 1);
    }

    if (assetSegments.length === 0) {
      return null;
    }

    const lastSegment = stripFileExtension(assetSegments[assetSegments.length - 1]);
    if (!lastSegment) {
      return null;
    }

    assetSegments[assetSegments.length - 1] = lastSegment;
    const publicId = assetSegments.join("/");
    if (!publicId || publicId.length > 255 || publicId.includes("..")) {
      return null;
    }

    return publicId;
  } catch {
    return null;
  }
}

export async function deleteCloudinaryImage(
  config: AppConfig,
  publicId: string,
): Promise<void> {
  if (!config.cloudinaryApiKey || !config.cloudinaryApiSecret) {
    throw new HttpError(500, "Cloudinary delete is not configured", {
      expose: false,
    });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signatureBase = `public_id=${publicId}&timestamp=${timestamp}${config.cloudinaryApiSecret}`;
  const signature = await sha1Hex(signatureBase);

  const form = new URLSearchParams();
  form.set("public_id", publicId);
  form.set("timestamp", timestamp.toString());
  form.set("api_key", config.cloudinaryApiKey);
  form.set("signature", signature);
  form.set("invalidate", "true");

  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudinaryCloudName)}/image/destroy`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new HttpError(502, "Failed to delete Cloudinary image", {
      expose: false,
    });
  }

  if (!response.ok) {
    throw new HttpError(502, "Failed to delete Cloudinary image", {
      expose: false,
    });
  }

  const result =
    typeof payload === "object" &&
    payload !== null &&
    "result" in payload &&
    typeof (payload as { result: unknown }).result === "string"
      ? (payload as { result: string }).result.toLowerCase()
      : "";

  if (result !== "ok" && result !== "not found") {
    throw new HttpError(502, "Failed to delete Cloudinary image", {
      expose: false,
    });
  }
}
