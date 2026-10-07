// Confirmação de senha antes de ações perigosas (estorno, recálculo do catálogo).
import { getPrisma } from "@achadinhos/db";
import { verifyPassword } from "./password";
import { rateLimit } from "./rate-limit";

/** Senha do usuário logado confere? (máx. 5 tentativas a cada 10 minutos) */
export async function confirmPassword(userId: string, password: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!rateLimit(`reauth:${userId}`, 5, 10 * 60_000)) return { ok: false, error: "Muitas tentativas. Espere 10 minutos." };
  if (typeof password !== "string" || password.length === 0 || password.length > 128) return { ok: false, error: "Digite a sua senha." };
  const user = await getPrisma().user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user || !(await verifyPassword(user.passwordHash, password))) return { ok: false, error: "Senha incorreta." };
  return { ok: true };
}
