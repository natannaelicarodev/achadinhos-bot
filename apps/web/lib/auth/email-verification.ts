// Confirmação de e-mail (fase 9). Sem confirmar: usa o painel, mas não assina nem envia aos grupos,
// e e-mail da lista de administradores NÃO vira administrador. No banco fica só o SHA-256 do token.
import { grantAdminPlan, isAdminEmail, type PrismaClient } from "@achadinhos/db";
import { generateToken, hashToken } from "./tokens";

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/** Reenvio: no máximo 1 a cada 2 minutos. */
export const EMAIL_VERIFICATION_RESEND_MS = 2 * 60 * 1000;

export type CreateVerificationResult =
  | { ok: true; token: string }
  | { ok: false; reason: "ALREADY_VERIFIED" }
  | { ok: false; reason: "TOO_SOON"; retryInSeconds: number };

/** Novo link de confirmação (invalida os anteriores). Respeita o intervalo de reenvio. */
export async function createEmailVerification(client: PrismaClient, userId: string, now: Date = new Date()): Promise<CreateVerificationResult> {
  const user = await client.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerifiedAt: true } });
  if (user.emailVerifiedAt) return { ok: false, reason: "ALREADY_VERIFIED" };
  const last = await client.emailVerificationToken.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  if (last && now.getTime() - last.createdAt.getTime() < EMAIL_VERIFICATION_RESEND_MS) {
    return { ok: false, reason: "TOO_SOON", retryInSeconds: Math.ceil((EMAIL_VERIFICATION_RESEND_MS - (now.getTime() - last.createdAt.getTime())) / 1000) };
  }
  const token = generateToken();
  await client.$transaction([
    client.emailVerificationToken.deleteMany({ where: { userId } }),
    client.emailVerificationToken.create({
      data: { id: hashToken(token), userId, expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS), createdAt: now },
    }),
  ]);
  return { ok: true, token };
}

/**
 * Confirma o e-mail pelo link (uso único, 24h). E-mail da lista de administradores ganha o plano
 * Administrador SÓ aqui (depois de provar que é dono do e-mail).
 */
export async function verifyEmailToken(client: PrismaClient, token: string, now: Date = new Date(), adminList: string | undefined = process.env.SYSTEM_ADMIN_EMAILS) {
  const row = await client.emailVerificationToken.findUnique({ where: { id: hashToken(token) } });
  if (!row || row.expiresAt <= now) return { ok: false as const };
  const user = await client.$transaction(async (tx) => {
    // Apaga só se ainda existir (evita uso duplo concorrente).
    const { count } = await tx.emailVerificationToken.deleteMany({ where: { id: row.id } });
    if (count === 0) return null;
    await tx.emailVerificationToken.deleteMany({ where: { userId: row.userId } });
    return tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: now }, select: { id: true, email: true, tenantId: true } });
  });
  if (!user) return { ok: false as const };
  if (isAdminEmail(user.email, adminList)) await grantAdminPlan(client, user.tenantId, now);
  return { ok: true as const, userId: user.id };
}
