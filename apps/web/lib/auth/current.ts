// Integração com o Next.js (cookies/redirect). A lógica fica em session.ts.
import { forTenant, getPrisma } from "@achadinhos/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "./cookie";
import { validateSessionToken } from "./session";

export const getCurrentSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return validateSessionToken(getPrisma(), token);
});

/** Sessão obrigatória: sem login, vai para /login. */
export async function requireSession() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session;
}

/** Client Prisma do tenant logado. Use em toda página/ação do painel. */
export async function getTenantDb() {
  const { user } = await requireSession();
  return { db: forTenant(user.tenantId), user };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE_NAME, token, sessionCookieOptions(expiresAt));
}

export async function deleteSessionCookie() {
  (await cookies()).set(SESSION_COOKIE_NAME, "", { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
}
