const TOKEN_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const BYTE_LIMIT =
  Math.floor(256 / TOKEN_ALPHABET.length) * TOKEN_ALPHABET.length;
const textEncoder = new TextEncoder();
const PASSWORD_HASH_PREFIX = "pbkdf2_sha256";
const PASSWORD_HASH_ITERATIONS = 210_000;
const PASSWORD_HASH_SALT_BYTES = 16;
const PASSWORD_HASH_KEY_BYTES = 32;

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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function timingSafeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

async function derivePasswordKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const normalizedSalt = new Uint8Array(salt);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: normalizedSalt,
      iterations,
    },
    keyMaterial,
    PASSWORD_HASH_KEY_BYTES * 8,
  );

  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(PASSWORD_HASH_SALT_BYTES);
  crypto.getRandomValues(salt);
  const derived = await derivePasswordKey(password, salt, PASSWORD_HASH_ITERATIONS);

  return [
    PASSWORD_HASH_PREFIX,
    String(PASSWORD_HASH_ITERATIONS),
    bytesToBase64(salt),
    bytesToBase64(derived),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash) {
    return false;
  }

  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== PASSWORD_HASH_PREFIX) {
    return false;
  }

  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 100_000 || iterations > 1_000_000) {
    return false;
  }

  try {
    const salt = base64ToBytes(parts[2]);
    const expected = base64ToBytes(parts[3]);
    const derived = await derivePasswordKey(password, salt, iterations);
    return timingSafeEqualBytes(derived, expected);
  } catch {
    return false;
  }
}
