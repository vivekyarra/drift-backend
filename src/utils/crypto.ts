const TOKEN_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const BYTE_LIMIT =
  Math.floor(256 / TOKEN_ALPHABET.length) * TOKEN_ALPHABET.length;
const textEncoder = new TextEncoder();
const PASSWORD_HASH_PREFIX = "pbkdf2_sha256";
// Cloudflare Workers currently supports PBKDF2 iterations up to 100000.
const PASSWORD_HASH_ITERATIONS = 100_000;
const PASSWORD_HASH_MAX_ITERATIONS = 100_000;
const PASSWORD_HASH_SALT_BYTES = 16;
const PASSWORD_HASH_KEY_BYTES = 32;
const PASSWORD_CIPHER_PREFIX = "aesgcm_v1";
const PASSWORD_CIPHER_IV_BYTES = 12;

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

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left, 0);
  merged.set(right, left.length);
  return merged;
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

async function deriveEncryptionKey(secret: string): Promise<CryptoKey> {
  const secretDigest = await crypto.subtle.digest("SHA-256", textEncoder.encode(secret));
  return crypto.subtle.importKey(
    "raw",
    secretDigest,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
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
  if (
    !Number.isFinite(iterations) ||
    iterations < PASSWORD_HASH_ITERATIONS ||
    iterations > PASSWORD_HASH_MAX_ITERATIONS
  ) {
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

export async function encryptPasswordForAdmin(
  plainPassword: string,
  encryptionSecret: string,
): Promise<string> {
  const iv = new Uint8Array(PASSWORD_CIPHER_IV_BYTES);
  crypto.getRandomValues(iv);

  const key = await deriveEncryptionKey(encryptionSecret);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    textEncoder.encode(plainPassword),
  );
  const payload = concatBytes(iv, new Uint8Array(encrypted));
  return `${PASSWORD_CIPHER_PREFIX}$${bytesToBase64(payload)}`;
}

export async function decryptPasswordForAdmin(
  cipherText: string | null | undefined,
  encryptionSecret: string | null,
): Promise<string | null> {
  if (!cipherText || !encryptionSecret) {
    return null;
  }

  const [prefix, encodedPayload] = cipherText.split("$");
  if (prefix !== PASSWORD_CIPHER_PREFIX || !encodedPayload) {
    return null;
  }

  try {
    const payload = base64ToBytes(encodedPayload);
    if (payload.length <= PASSWORD_CIPHER_IV_BYTES) {
      return null;
    }

    const iv = payload.slice(0, PASSWORD_CIPHER_IV_BYTES);
    const data = payload.slice(PASSWORD_CIPHER_IV_BYTES);
    const key = await deriveEncryptionKey(encryptionSecret);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      data,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}
