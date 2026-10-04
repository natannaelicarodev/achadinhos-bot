import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export interface EncryptedPayload {
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  authTag: Uint8Array<ArrayBuffer>;
}

/** Converte a chave em base64 (32 bytes) do .env para Buffer. */
export function parseEncryptionKey(base64: string): Buffer {
  const trimmed = base64.trim();
  const key = BASE64_PATTERN.test(trimmed) ? Buffer.from(trimmed, "base64") : Buffer.alloc(0);
  if (key.length !== KEY_LENGTH) {
    throw new Error("Chave de criptografia inválida: precisa ter 32 bytes em base64.");
  }
  return key;
}

function toBytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buffer);
}

/**
 * AES-256-GCM. `aad` (dado associado) amarra o ciphertext ao contexto
 * (ex.: tenantId:store) — copiado para outro contexto, não descriptografa.
 */
export function encrypt(plaintext: string, key: Buffer, aad: string): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: toBytes(ciphertext), iv: toBytes(iv), authTag: toBytes(cipher.getAuthTag()) };
}

/** Lança erro se a chave, o AAD ou qualquer byte do payload não conferir. */
export function decrypt(payload: EncryptedPayload, key: Buffer, aad: string): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(payload.authTag));
  return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext)), decipher.final()]).toString("utf8");
}
