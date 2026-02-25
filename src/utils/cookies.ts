export const SESSION_COOKIE_NAME = "session";

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
    "SameSite=Strict",
    "Path=/",
    "Max-Age=2592000",
  ].join("; ");
}
