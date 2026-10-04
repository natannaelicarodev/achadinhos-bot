import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

// argon2id (padrão da lib) com parâmetros mínimos recomendados pela OWASP.
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 };

export const passwordSchema = z
  .string()
  .min(8, "A senha precisa ter pelo menos 8 caracteres.")
  .max(128, "A senha pode ter no máximo 128 caracteres.");

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Gasta o mesmo tempo de uma verificação real (e-mail inexistente não responde mais rápido). */
export async function verifyDummyPassword(password: string): Promise<false> {
  dummyHash ??= hashPassword("senha-ficticia-para-tempo-constante");
  await verifyPassword(await dummyHash, password);
  return false;
}
