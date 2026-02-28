import type { AppContext } from "../types";
import { HttpError } from "../utils/errors";

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export function requireAdmin(ctx: AppContext): void {
  const configured = ctx.config.adminApiKey;
  if (!configured) {
    throw new HttpError(503, "Admin routes are not configured");
  }

  const incoming = ctx.request.headers.get("x-admin-secret")?.trim();
  if (!incoming || !timingSafeEqual(incoming, configured)) {
    throw new HttpError(403, "Forbidden");
  }
}
