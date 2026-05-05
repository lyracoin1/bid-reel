/**
 * vault-crypto.ts — AES-256-GCM encryption for Digital Vault content
 *
 * The encryption key is loaded from the VAULT_ENCRYPTION_KEY environment
 * variable (base64-encoded 32-byte key). It is loaded ONCE at module
 * initialisation time.
 *
 * Security contract:
 *   - Plaintext is NEVER logged, stored in transit, or returned from
 *     any endpoint other than the authorised buyer/admin reveal routes.
 *   - A fresh random 12-byte IV is generated per encryption call.
 *   - Both ciphertext and IV are stored as base64 strings in the DB.
 *   - A 16-byte GCM auth tag is appended to the ciphertext for integrity.
 *   - Decryption fails loudly if the key is wrong or data is tampered.
 *
 * IMPORTANT: Never log the return value of decryptVault().
 */

import crypto from "node:crypto";
import { logger } from "./logger";

const ALGORITHM = "aes-256-gcm" as const;
const KEY_BYTES = 32;
const IV_BYTES  = 12;
const TAG_BYTES = 16;

// ── Key loading (once at startup) ─────────────────────────────────────────────

const RAW_KEY = process.env["VAULT_ENCRYPTION_KEY"] ?? null;
let _key: Buffer | null = null;

if (RAW_KEY) {
  try {
    const decoded = Buffer.from(RAW_KEY, "base64");
    if (decoded.length !== KEY_BYTES) {
      logger.error(
        { keyLength: decoded.length, expected: KEY_BYTES },
        "vault-crypto: VAULT_ENCRYPTION_KEY must decode to exactly 32 bytes — vault disabled",
      );
    } else {
      _key = decoded;
      logger.info("vault-crypto: encryption key loaded successfully");
    }
  } catch {
    logger.error(
      "vault-crypto: failed to base64-decode VAULT_ENCRYPTION_KEY — vault disabled",
    );
  }
} else {
  logger.warn(
    "vault-crypto: VAULT_ENCRYPTION_KEY is not set — digital vault endpoints will be unavailable",
  );
}

/** Returns true when the vault key is correctly loaded and ready. */
export function isVaultKeyReady(): boolean {
  return _key !== null;
}

/**
 * Encrypt plaintext using AES-256-GCM.
 *
 * Returns:
 *   ciphertext — base64 string of (encrypted bytes || 16-byte auth tag)
 *   iv         — base64 string of the random 12-byte IV used
 *
 * Throws if the encryption key is not loaded.
 * IMPORTANT: Do not log the `plaintext` argument.
 */
export function encryptVault(plaintext: string): { ciphertext: string; iv: string } {
  if (!_key) {
    throw new Error(
      "VAULT_ENCRYPTION_KEY is not configured — cannot encrypt vault data.",
    );
  }

  const iv     = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, _key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Append auth tag so decryptVault can verify integrity without a separate field
  const combined = Buffer.concat([encrypted, tag]);

  return {
    ciphertext: combined.toString("base64"),
    iv:         iv.toString("base64"),
  };
}

/**
 * Decrypt a vault ciphertext produced by encryptVault.
 *
 * Both `ciphertext` and `iv` must be the exact base64 strings stored in the DB.
 * Throws on any failure — wrong key, corrupted data, authentication tag mismatch.
 *
 * IMPORTANT: Never log the string returned by this function.
 */
export function decryptVault(ciphertext: string, iv: string): string {
  if (!_key) {
    throw new Error(
      "VAULT_ENCRYPTION_KEY is not configured — cannot decrypt vault data.",
    );
  }

  const combined = Buffer.from(ciphertext, "base64");
  const ivBuf    = Buffer.from(iv, "base64");

  if (combined.length < TAG_BYTES) {
    throw new Error("Vault ciphertext is too short — data may be corrupted.");
  }

  const encryptedData = combined.subarray(0, combined.length - TAG_BYTES);
  const tag           = combined.subarray(combined.length - TAG_BYTES);

  const decipher = crypto.createDecipheriv(ALGORITHM, _key, ivBuf);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encryptedData),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
