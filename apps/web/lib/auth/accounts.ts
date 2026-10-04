import { randomBytes } from "node:crypto";
import { Prisma, startTrial, type PrismaClient } from "@achadinhos/db";
import { hashPassword, verifyDummyPassword, verifyPassword } from "./password";
import type { SignUpInput } from "./schemas";
import { invalidateUserSessions } from "./session";
import { generateToken, hashToken } from "./tokens";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function slugify(text: string): string {
  const base = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "conta"}-${randomBytes(3).toString("hex")}`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Cadastro: tenant + usuário dono + trial de 7 dias no plano Iniciante. */
export async function signUp(
  client: PrismaClient,
  input: SignUpInput,
  now: Date = new Date(),
): Promise<{ ok: true; userId: string } | { ok: false; error: "EMAIL_TAKEN" }> {
  const existing = await client.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) return { ok: false, error: "EMAIL_TAKEN" };

  const passwordHash = await hashPassword(input.password);
  try {
    const user = await client.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: input.tenantName, slug: slugify(input.tenantName) } });
      const owner = await tx.user.create({
        data: { tenantId: tenant.id, email: input.email, name: input.name, passwordHash, role: "OWNER" },
      });
      await startTrial(tx, tenant.id, now);
      return owner;
    });
    return { ok: true, userId: user.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "EMAIL_TAKEN" };
    throw error;
  }
}

/** Usuário se e-mail e senha conferem; null caso contrário (mesmo tempo nos dois casos). */
export async function authenticate(client: PrismaClient, email: string, password: string) {
  const user = await client.user.findUnique({ where: { email } });
  if (!user) return verifyDummyPassword(password).then(() => null);
  return (await verifyPassword(user.passwordHash, password)) ? user : null;
}

/** Gera token de recuperação (invalida os anteriores). null se o e-mail não existe. */
export async function createPasswordResetToken(client: PrismaClient, email: string, now: Date = new Date()) {
  const user = await client.user.findUnique({ where: { email }, select: { id: true, name: true, email: true } });
  if (!user) return null;

  const token = generateToken();
  await client.$transaction([
    client.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    client.passwordResetToken.create({
      data: { tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS) },
    }),
  ]);
  return { token, user };
}

/** Troca a senha com token de uso único e derruba todas as sessões do usuário. */
export async function resetPasswordWithToken(
  client: PrismaClient,
  token: string,
  newPassword: string,
  now: Date = new Date(),
): Promise<"ok" | "invalid"> {
  const row = await client.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.usedAt || row.expiresAt <= now) return "invalid";

  const passwordHash = await hashPassword(newPassword);
  const consumed = await client.$transaction(async (tx) => {
    // Marca como usado só se ainda estiver livre (evita uso duplo concorrente).
    const { count } = await tx.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count === 0) return false;
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
    return true;
  });
  if (!consumed) return "invalid";

  await invalidateUserSessions(client, row.userId);
  return "ok";
}
