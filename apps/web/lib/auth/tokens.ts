import { createHash, randomBytes } from "node:crypto";

/** Token aleatório de 256 bits (vai no cookie ou no link de e-mail). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** No banco fica só o hash: vazamento do banco não entrega tokens válidos. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
