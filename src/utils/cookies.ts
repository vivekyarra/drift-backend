export const SESSION_COOKIE_NAME = "session";
export const CSRF_COOKIE_NAME = "csrf_token";

export function getCookie(request: Request, cookieName: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const [rawName, ...rawValueParts] = pair.trim().split("=");
    if (rawName !== cookieName) {
      continue;
    }

    const rawValue = rawValueParts.join("=");
    if (!rawValue) {
      return null;
    }

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

export function buildSessionCookie(sessionToken: string): string {
  const value = encodeURIComponent(sessionToken);
  return [
    `${SESSION_COOKIE_NAME}=${value}`,
    "HttpOnly",
    "Secure",
    "SameSite=None",
    "Partitioned",
    "Path=/",
    "Max-Age=604800",
  ].join("; ");
}

export function buildCsrfCookie(csrfToken: string): string {
  const value = encodeURIComponent(csrfToken);
  return [
    `${CSRF_COOKIE_NAME}=${value}`,
    "Secure",
    "SameSite=None",
    "Partitioned",
    "Path=/",
    "Max-Age=604800",
  ].join("; ");
}

export function clearSessionCookie(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Max-Age=0",
    "Path=/",
    "SameSite=None",
    "Partitioned",
    "Secure",
    "HttpOnly",
  ].join("; ");
}

export function clearCsrfCookie(): string {
  return [
    `${CSRF_COOKIE_NAME}=`,
    "Max-Age=0",
    "Path=/",
    "SameSite=None",
    "Partitioned",
    "Secure",
  ].join("; ");
}
