import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, parseEncryptionKey } from "../src/crypto";
import { maskSecret } from "../src/store-credentials";

const key = randomBytes(32);
const aad = "tenant-1:AMAZON";

describe("AES-256-GCM", () => {
  it("criptografa e descriptografa (ida e volta)", () => {
    const payload = encrypt('{"token":"segredo"}', key, aad);
    expect(Buffer.from(payload.ciphertext).toString("utf8")).not.toContain("segredo");
    expect(payload.iv).toHaveLength(12);
    expect(payload.authTag).toHaveLength(16);
    expect(decrypt(payload, key, aad)).toBe('{"token":"segredo"}');
  });

  it("usa IV diferente a cada chamada", () => {
    const p1 = encrypt("mesmo texto", key, aad);
    const p2 = encrypt("mesmo texto", key, aad);
    expect(Buffer.from(p1.iv).equals(Buffer.from(p2.iv))).toBe(false);
    expect(Buffer.from(p1.ciphertext).equals(Buffer.from(p2.ciphertext))).toBe(false);
  });

  it("falha se o ciphertext for adulterado", () => {
    const payload = encrypt("segredo", key, aad);
    payload.ciphertext[0] = (payload.ciphertext[0] ?? 0) ^ 0xff;
    expect(() => decrypt(payload, key, aad)).toThrow();
  });

  it("falha se o authTag for adulterado", () => {
    const payload = encrypt("segredo", key, aad);
    payload.authTag[0] = (payload.authTag[0] ?? 0) ^ 0xff;
    expect(() => decrypt(payload, key, aad)).toThrow();
  });

  it("falha com AAD diferente (outro tenant/loja)", () => {
    const payload = encrypt("segredo", key, aad);
    expect(() => decrypt(payload, key, "tenant-2:AMAZON")).toThrow();
  });

  it("falha com chave errada", () => {
    const payload = encrypt("segredo", key, aad);
    expect(() => decrypt(payload, randomBytes(32), aad)).toThrow();
  });
});

describe("parseEncryptionKey", () => {
  it("aceita 32 bytes em base64", () => {
    expect(parseEncryptionKey(key.toString("base64"))).toEqual(key);
  });

  it("recusa tamanho errado ou texto que não é base64", () => {
    expect(() => parseEncryptionKey(randomBytes(16).toString("base64"))).toThrow();
    expect(() => parseEncryptionKey("não é base64!")).toThrow();
    expect(() => parseEncryptionKey("")).toThrow();
  });
});

describe("maskSecret", () => {
  it("mostra só os 4 últimos caracteres", () => {
    expect(maskSecret("abcdef123456")).toBe("••••3456");
    expect(maskSecret("abc")).toBe("••••");
  });
});
