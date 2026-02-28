import { jsonResponse } from "../utils/http";

const ALLOWED_METHODS = "GET,POST,PATCH,DELETE,OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization, X-CSRF-Token, X-Admin-Secret";

function setCorsHeaders(headers: Headers, allowedOrigin: string): void {
  headers.set("Access-Control-Allow-Origin", allowedOrigin);
  headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Vary", "Origin");
}

function requestOrigin(request: Request): string | null {
  return request.headers.get("origin")?.trim() ?? null;
}

function isAllowedOrigin(origin: string | null, allowedOrigin: string): boolean {
  return origin === allowedOrigin;
}

export function handleCorsPreflight(
  request: Request,
  allowedOrigin: string,
): Response | null {
  if (request.method.toUpperCase() !== "OPTIONS") {
    return null;
  }

  const origin = requestOrigin(request);
  if (!isAllowedOrigin(origin, allowedOrigin)) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  const headers = new Headers();
  setCorsHeaders(headers, allowedOrigin);
  return new Response(null, { status: 204, headers });
}

export function rejectDisallowedOrigin(
  request: Request,
  allowedOrigin: string,
): Response | null {
  const origin = requestOrigin(request);
  if (!origin) {
    return null;
  }

  if (!isAllowedOrigin(origin, allowedOrigin)) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  return null;
}

export function withCorsHeaders(
  request: Request,
  response: Response,
  allowedOrigin: string,
): Response {
  const origin = requestOrigin(request);
  if (!isAllowedOrigin(origin, allowedOrigin)) {
    return response;
  }

  response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
  response.headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  response.headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set("Vary", "Origin");
  return response;
}
