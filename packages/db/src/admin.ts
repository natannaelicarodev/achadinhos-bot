// Contas administradoras do sistema (SYSTEM_ADMIN_EMAILS): recebem o plano interno "Administrador"
// (sem limites de plano). Operação de sistema: usa o client cru, só para os e-mails da lista.
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { ADMIN_PLAN } from "./plans";

type Tx = Prisma.TransactionClient | PrismaClient;

/** Assinatura das contas administradoras: não vence. */
const ADMIN_PERIOD_END = new Date("2099-12-31T23:59:59Z");

/** "a@x.com, B@y.com" -> ["a@x.com", "b@y.com"]. */
export function parseAdminEmails(list: string | undefined): string[] {
  return (list ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const isAdminEmail = (email: string, list: string | undefined = process.env.SYSTEM_ADMIN_EMAILS) =>
  parseAdminEmails(list).includes(email.trim().toLowerCase());

/** Plano "Administrador" no banco (cria/atualiza; idempotente). */
export function upsertAdminPlan(tx: Tx) {
  return tx.plan.upsert({ where: { code: ADMIN_PLAN.code }, create: ADMIN_PLAN, update: ADMIN_PLAN });
}

/** Põe o tenant no plano "Administrador", ativo e sem vencimento. Idempotente. */
export async function grantAdminPlan(tx: Tx, tenantId: string, now: Date = new Date()): Promise<boolean> {
  const plan = await upsertAdminPlan(tx);
  const current = await tx.subscription.findFirst({
    where: { tenantId, status: { not: "CANCELED" } },
    orderBy: { createdAt: "desc" },
  });
  const data = { planId: plan.id, status: "ACTIVE" as const, trialEndsAt: null, currentPeriodEnd: ADMIN_PERIOD_END };
  if (current) {
    if (current.planId === plan.id && current.status === "ACTIVE" && current.currentPeriodEnd >= ADMIN_PERIOD_END) return false;
    await tx.subscription.update({ where: { id: current.id }, data });
    return true;
  }
  await tx.subscription.create({ data: { tenantId, currentPeriodStart: now, ...data } });
  return true;
}

/** Aplica o plano "Administrador" às contas da lista que já existem. Devolve os e-mails alterados. */
export async function syncAdminAccounts(client: PrismaClient, list: string | undefined = process.env.SYSTEM_ADMIN_EMAILS) {
  const emails = parseAdminEmails(list);
  if (emails.length === 0) return { granted: [] as string[], missing: [] as string[] };
  const users = await client.user.findMany({ where: { email: { in: emails } }, select: { email: true, tenantId: true } });
  const granted: string[] = [];
  for (const user of users) {
    if (await grantAdminPlan(client, user.tenantId)) granted.push(user.email);
  }
  const found = new Set(users.map((u) => u.email));
  return { granted, missing: emails.filter((e) => !found.has(e)) };
}
