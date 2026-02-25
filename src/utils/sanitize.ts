const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const USERNAME_REGEX = /^[A-Za-z0-9_]{3,20}$/;
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

export function sanitizeImageUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") {
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
