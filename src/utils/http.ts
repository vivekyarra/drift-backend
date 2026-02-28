import { HttpError } from "./errors";

const BASE_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
};

export function jsonResponse(
  payload: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  const mergedHeaders = new Headers(BASE_HEADERS);
  if (headers) {
    const inputHeaders = headers instanceof Headers ? headers : new Headers(headers);

    // Preserve multiple Set-Cookie headers instead of collapsing to one.
    const maybeGetSetCookie = (
      inputHeaders as Headers & { getSetCookie?: () => string[] }
    ).getSetCookie;
    if (typeof maybeGetSetCookie === "function") {
      for (const cookie of maybeGetSetCookie.call(inputHeaders)) {
        mergedHeaders.append("Set-Cookie", cookie);
      }
    } else {
      const singleSetCookie = inputHeaders.get("set-cookie");
      if (singleSetCookie) {
        mergedHeaders.append("Set-Cookie", singleSetCookie);
      }
    }

    inputHeaders.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") {
        return;
      }
      mergedHeaders.set(key, value);
    });
  }

  return new Response(JSON.stringify(payload), {
    status,
    headers: mergedHeaders,
  });
}

export async function parseJsonBody<T>(
  request: Request,
  maxBodyBytes = 8_192,
): Promise<T> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      throw new HttpError(413, "Request body too large");
    }
  }

  const rawBody = await request.text();
  if (rawBody.length === 0) {
    throw new HttpError(400, "Request body is required");
  }

  if (rawBody.length > maxBodyBytes) {
    throw new HttpError(413, "Request body too large");
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

export function clientIpFromRequest(request: Request): string {
  const cfConnectingIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const firstIp = xForwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  return "unknown";
}

export function parseIsoTimestampParam(
  value: string | null,
  invalidMessage: string,
): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, invalidMessage);
  }

  return parsed.toISOString();
}

export function parsePositiveIntParam(
  value: string | null,
  options: {
    min: number;
    max: number;
    fallback: number;
    invalidMessage: string;
  },
): number {
  if (!value) {
    return options.fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < options.min || parsed > options.max) {
    throw new HttpError(400, options.invalidMessage);
  }
  return parsed;
}
