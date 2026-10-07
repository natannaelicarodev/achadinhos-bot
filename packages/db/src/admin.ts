// Contas administradoras do sistema (SYSTEM_ADMIN_EMAILS): plano interno "Administrador" (sem limites
// de plano). SÓ com o e-mail CONFIRMADO pelo link (senão qualquer um se cadastraria com o e-mail da
// lista). Operação de sistema: client cru, só para as contas da lista.
import { grantEntitlement, logBilling, revokeSourceEntitlements } from "./entitlements";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { ADMIN_PLAN } from "./plans";

type Tx = Prisma.TransactionClient | PrismaClient;

/** Direito de administrador: não vence (é revogado se o e-mail sair da lista). */
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

/** Administrador do sistema = e-mail na lista E confirmado. */
export const isVerifiedAdmin = (
  user: { email: string; emailVerifiedAt: Date | null },
  list: string | undefined = process.env.SYSTEM_ADMIN_EMAILS,
) => user.emailVerifiedAt !== null && isAdminEmail(user.email, list);

/** Plano "Administrador" no banco (cria/atualiza; idempotente). */
export function upsertAdminPlan(tx: Tx) {
  return tx.plan.upsert({ where: { code: ADMIN_PLAN.code }, create: ADMIN_PLAN, update: ADMIN_PLAN });
}

/** Põe o tenant no plano "Administrador" (assinatura ativa + direito de uso ADMIN). Idempotente. */
export async function grantAdminPlan(tx: Tx, tenantId: string, now: Date = new Date()): Promise<boolean> {
  const plan = await upsertAdminPlan(tx);
  const valid = await tx.entitlement.findFirst({ where: { tenantId, source: "ADMIN", revokedAt: null, endsAt: { gt: now } } });
  const current = await tx.subscription.findFirst({ where: { tenantId, status: { not: "CANCELED" } }, orderBy: { createdAt: "desc" } });
  const data = {
    planId: plan.id,
    status: "ACTIVE" as const,
    trialEndsAt: null,
    pastDueSince: null,
    currentPeriodEnd: ADMIN_PERIOD_END,
    pendingPlanId: null,
    pendingBillingCycle: null,
    pendingPlanAt: null,
    pendingPlanPaymentId: null,
    pendingAmountCents: null,
  };
  if (valid && current?.planId === plan.id && current.status === "ACTIVE") return false;
  if (current) await tx.subscription.update({ where: { id: current.id }, data });
  else await tx.subscription.create({ data: { tenantId, currentPeriodStart: now, ...data } });
  if (!valid) {
    await grantEntitlement(tx, { tenantId, planId: plan.id, source: "ADMIN", startsAt: now, endsAt: ADMIN_PERIOD_END });
  }
  await logBilling(tx, tenantId, "SYSTEM", "admin_granted", {});
  return true;
}

/**
 * Sincroniza as contas administradoras: aplica o plano às da lista com e-mail confirmado e
 * REVOGA o direito de administrador de quem saiu da lista (ou nunca confirmou o e-mail).
 */
export async function syncAdminAccounts(client: PrismaClient, list: string | undefined = process.env.SYSTEM_ADMIN_EMAILS, now: Date = new Date()) {
  const emails = parseAdminEmails(list);
  const users = emails.length
    ? await client.user.findMany({ where: { email: { in: emails } }, select: { email: true, tenantId: true, emailVerifiedAt: true } })
    : [];
  const granted: string[] = [];
  const adminTenants = new Set<string>();
  for (const user of users) {
    if (!user.emailVerifiedAt) continue;
    adminTenants.add(user.tenantId);
    if (await grantAdminPlan(client, user.tenantId, now)) granted.push(user.email);
  }
  const revoked: string[] = [];
  const holders = await client.entitlement.findMany({
    where: { source: "ADMIN", revokedAt: null, endsAt: { gt: now } },
    select: { tenantId: true },
    distinct: ["tenantId"],
  });
  for (const h of holders) {
    if (adminTenants.has(h.tenantId)) continue;
    await revokeSourceEntitlements(client, h.tenantId, "ADMIN", "E-mail fora da lista de administradores ou não confirmado.", now);
    revoked.push(h.tenantId);
  }
  const found = new Set(users.map((u) => u.email));
  const unverified = users.filter((u) => !u.emailVerifiedAt).map((u) => u.email);
  return { granted, revoked, unverified, missing: emails.filter((e) => !found.has(e)) };
}
