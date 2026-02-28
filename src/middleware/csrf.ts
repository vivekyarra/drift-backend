import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME, getCookie } from "../utils/cookies";
import { HttpError } from "../utils/errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_HEADER_NAME = "x-csrf-token";

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

export function ensureCsrf(request: Request, allowedOrigin: string): void {
  const method = request.method.toUpperCase();
  if (SAFE_METHODS.has(method)) {
    return;
  }

  // Only enforce CSRF when a session cookie is present.
  const sessionCookie = getCookie(request, SESSION_COOKIE_NAME);
  if (!sessionCookie) {
    return;
  }

  const origin = request.headers.get("origin")?.trim() ?? "";
  if (!origin || origin !== allowedOrigin) {
    throw new HttpError(403, "Forbidden");
  }

  const csrfCookie = getCookie(request, CSRF_COOKIE_NAME);
  const csrfHeader = request.headers.get(CSRF_HEADER_NAME)?.trim() ?? "";

  // For cross-origin frontend deployments, frontend JS cannot read backend
  // cookies on a different domain, so header validation is optional.
  // If no header is sent, strict origin + session validation is used.
  if (!csrfHeader) {
    return;
  }

  if (!csrfCookie) {
    throw new HttpError(403, "Forbidden");
  }

  if (csrfCookie.length > 256 || csrfHeader.length > 256) {
    throw new HttpError(403, "Forbidden");
  }

  if (!timingSafeEqual(csrfCookie, csrfHeader)) {
    throw new HttpError(403, "Forbidden");
  }
}
