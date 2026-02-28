const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const USERNAME_REGEX = /^[A-Za-z0-9_]{3,20}$/;
const USERNAME_BASE_REGEX = /^[A-Za-z0-9_]{3,16}$/;
const CHANNEL_REGEX = /^[A-Za-z0-9_-]{1,32}$/;
const UUID_V4ISH_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeBasic(input: string): string {
  return input.normalize("NFKC").replace(CONTROL_CHARS, " ");
}

export function sanitizeUsername(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const sanitized = normalizeBasic(value).trim().toLowerCase();
  if (!USERNAME_REGEX.test(sanitized)) {
    return null;
  }

  return sanitized;
}

export function sanitizeChannel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const sanitized = normalizeBasic(value)
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();

  if (!CHANNEL_REGEX.test(sanitized)) {
    return null;
  }

  return sanitized;
}

export function sanitizeUsernameBase(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const sanitized = normalizeBasic(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
  if (!USERNAME_BASE_REGEX.test(sanitized)) {
    return null;
  }

  return sanitized;
}

export function sanitizeContent(value: unknown, maxLength = 500): string | null {
  if (typeof value !== "string") {
    return null;
  }

  let sanitized = value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(CONTROL_CHARS, " ")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();

  if (sanitized.length === 0 || sanitized.length > maxLength) {
    return null;
  }

  return sanitized;
}

export function sanitizeBio(value: unknown, maxLength = 200): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }

  const sanitized = value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, " ")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();

  if (sanitized.length > maxLength) {
    return null;
  }

  return sanitized || null;
}

export function sanitizeEmoji(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const sanitized = value.trim();
  if (!sanitized || sanitized.length > 16) {
    return null;
  }

  return sanitized;
}

export function sanitizeUuid(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const sanitized = value.trim().toLowerCase();
  if (!UUID_V4ISH_REGEX.test(sanitized)) {
    return null;
  }

  return sanitized;
}

function isLocalHostname(hostname: string): boolean {
  const lowered = hostname.toLowerCase();
  return lowered === "localhost" || lowered === "127.0.0.1" || lowered === "::1";
}

export function sanitizeImageUrl(
  value: unknown,
  cloudinaryCloudName: string,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.toLowerCase().startsWith("data:")) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") {
      return null;
    }

    if (isLocalHostname(url.hostname)) {
      return null;
    }

    if (url.hostname.toLowerCase() !== "res.cloudinary.com") {
      return null;
    }

    if (url.username || url.password) {
      return null;
    }

    if (url.port) {
      return null;
    }

    if (url.search || url.hash) {
      // Cloudinary transformations belong in the URL path, not query/fragment.
      return null;
    }

    const requiredPrefix = `/${cloudinaryCloudName.toLowerCase()}/image/`;
    if (!url.pathname.toLowerCase().startsWith(requiredPrefix)) {
      return null;
    }

    const serialized = url.toString();
    if (serialized.length > 2048) {
      return null;
    }

    return serialized;
  } catch {
    return null;
  }
}
