/**
 * Provider credential encryption — Phase 5 (2026-05-08).
 *
 * AES-256-GCM authenticated encryption for tenant-scoped phone-provider
 * credentials (Twilio Auth Token, webhook secret, etc). The key is held
 * server-side as a 32-byte base64 string in `COMMUNICATION_CREDENTIAL_KEY`.
 *
 * Why GCM (vs CBC + HMAC):
 *   * Authenticated — tampering with ciphertext fails decryption rather
 *     than producing garbage plaintext we'd silently send to the provider.
 *   * Single primitive — IV + ciphertext + auth tag stored as three
 *     base64 columns; no separate HMAC bookkeeping.
 *
 * Why not the QBO plaintext pattern:
 *   * QBO `access_token` is plaintext today (acceptable: short-lived,
 *     auto-rotates, realm-scoped). Replicating that pattern for Twilio
 *     would be a regression — Twilio Auth Tokens are long-lived
 *     tenant-master credentials. Leakage = full SMS+voice account
 *     compromise + billing fraud.
 *
 * Fail-closed startup contract:
 *   * `getEncryptionKey()` throws synchronously when the env var is
 *     missing or malformed (wrong length, not base64). No silent fallback
 *     to plaintext, no on-the-fly key generation. The first encrypt /
 *     decrypt call in a process boots the cache and surfaces the error
 *     immediately.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // GCM-recommended 96-bit IV
const KEY_LENGTH_BYTES = 32; // AES-256 → 32-byte key

/**
 * Sealed representation persisted to the database. All three fields are
 * base64-encoded. Keep them in sync — decryption requires all three.
 */
export interface SealedCredential {
  encrypted: string;
  iv: string;
  tag: string;
}

let cachedKey: Buffer | null = null;

/**
 * Resolve the encryption key from `COMMUNICATION_CREDENTIAL_KEY`.
 * The env var must be a 32-byte value encoded as base64 (44 chars,
 * including padding) so the resulting key is exactly 256 bits.
 *
 * Throws synchronously on:
 *   * Missing env var.
 *   * Value that doesn't decode as base64.
 *   * Decoded length other than 32 bytes.
 *
 * Cached after first successful resolution so repeated calls are cheap.
 */
function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.COMMUNICATION_CREDENTIAL_KEY;
  if (!raw || raw.length === 0) {
    throw new Error(
      "COMMUNICATION_CREDENTIAL_KEY is not set. Provider credentials cannot be encrypted at rest. Set the env var to a 32-byte base64 value before starting the server.",
    );
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, "base64");
  } catch {
    throw new Error(
      "COMMUNICATION_CREDENTIAL_KEY is not valid base64. Provide a 32-byte base64-encoded key.",
    );
  }
  if (decoded.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `COMMUNICATION_CREDENTIAL_KEY decoded to ${decoded.length} bytes; expected ${KEY_LENGTH_BYTES} bytes (AES-256). Generate with \`openssl rand -base64 32\`.`,
    );
  }
  cachedKey = decoded;
  return decoded;
}

/**
 * Reset the cached key — for tests that need to swap the env var
 * mid-suite. Production code must NOT call this.
 */
export function _resetEncryptionKeyCacheForTests(): void {
  cachedKey = null;
}

/**
 * Encrypt a plaintext credential. Returns three base64 fields ready
 * for direct insertion into the `*_iv` / `*_tag` / `encrypted_*` columns.
 */
export function sealCredential(plaintext: string): SealedCredential {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("sealCredential: plaintext must be a non-empty string");
  }
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

/**
 * Decrypt a sealed credential. Throws on tampering (auth tag mismatch),
 * malformed inputs, or wrong key. Callers MUST treat the plaintext as
 * sensitive — never log it, never return it to the client, never store
 * it in memory longer than the request that needs it.
 */
export function openCredential(sealed: SealedCredential): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(sealed.iv, "base64");
  const tag = Buffer.from(sealed.tag, "base64");
  const ciphertext = Buffer.from(sealed.encrypted, "base64");
  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error(
      `openCredential: stored IV is ${iv.length} bytes; expected ${IV_LENGTH_BYTES}.`,
    );
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
