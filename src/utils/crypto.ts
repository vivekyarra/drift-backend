const TOKEN_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const BYTE_LIMIT =
  Math.floor(256 / TOKEN_ALPHABET.length) * TOKEN_ALPHABET.length;
const textEncoder = new TextEncoder();

export function generateSecureToken(length: number): string {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error("Token length must be a positive integer");
  }

  let token = "";
  while (token.length < length) {
    const bytes = new Uint8Array(Math.max(16, (length - token.length) * 2));
    crypto.getRandomValues(bytes);

    for (const value of bytes) {
      if (value >= BYTE_LIMIT) {
        continue;
      }

      token += TOKEN_ALPHABET[value % TOKEN_ALPHABET.length];
      if (token.length === length) {
        break;
      }
    }
  }

  return token;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(input));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashDeviceFingerprint(
  request: Request,
): Promise<string | null> {
  const userAgent = request.headers.get("user-agent")?.trim() ?? "";
  const acceptLanguage = request.headers.get("accept-language")?.trim() ?? "";

  if (!userAgent && !acceptLanguage) {
    return null;
  }

  return sha256Hex(`${userAgent}|${acceptLanguage}`);
}
