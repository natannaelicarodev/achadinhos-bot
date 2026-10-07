import type { PrismaClient } from "@achadinhos/db";
import { SESSION_DURATION_MS } from "./cookie";
import { generateToken, hashToken } from "./tokens";

const RENEW_WHEN_LESS_THAN_MS = SESSION_DURATION_MS / 2;

export async function createSession(client: PrismaClient, userId: string, now: Date = new Date()) {
  const token = generateToken();
  const session = await client.session.create({
    data: { id: hashToken(token), userId, expiresAt: new Date(now.getTime() + SESSION_DURATION_MS) },
  });
  return { token, expiresAt: session.expiresAt };
}

const userSelect = {
  id: true,
  tenantId: true,
  email: true,
  name: true,
  role: true,
  emailVerifiedAt: true,
  tenant: { select: { id: true, name: true } },
} as const;

/** Sessão válida + usuário, ou null. Renova a validade quando passa da metade. */
export async function validateSessionToken(client: PrismaClient, token: string, now: Date = new Date()) {
  const session = await client.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: { select: userSelect } },
  });
  if (!session) return null;

  if (session.expiresAt <= now) {
    await client.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  let expiresAt = session.expiresAt;
  if (expiresAt.getTime() - now.getTime() < RENEW_WHEN_LESS_THAN_MS) {
    expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
    await client.session.update({ where: { id: session.id }, data: { expiresAt } });
  }

  return { session: { id: session.id, expiresAt }, user: session.user };
}

export type SessionWithUser = NonNullable<Awaited<ReturnType<typeof validateSessionToken>>>;

export async function invalidateSession(client: PrismaClient, sessionId: string) {
  await client.session.deleteMany({ where: { id: sessionId } });
}

export async function invalidateUserSessions(client: PrismaClient, userId: string) {
  await client.session.deleteMany({ where: { userId } });
}
