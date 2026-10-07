import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { getPrisma } from "./client";
import { fallbackPlan, grantEntitlement, resolveEntitlement } from "./entitlements";
import { TRIAL_PLAN_CODE } from "./plans";
import { forTenant } from "./tenant";

export const TRIAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

type Tx = Prisma.TransactionClient | PrismaClient;

/** Cria a assinatura de teste (7 dias, plano Iniciante) e o direito de uso do teste. Usado no cadastro. */
export async function startTrial(tx: Tx, tenantId: string, now: Date = new Date()) {
  const plan = await tx.plan.findUnique({ where: { code: TRIAL_PLAN_CODE } });
  if (!plan) throw new Error(`Plano "${TRIAL_PLAN_CODE}" não encontrado. Rode o seed (pnpm db:seed).`);
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
  const subscription = await tx.subscription.create({
    data: {
      tenantId,
      planId: plan.id,
      status: "TRIALING",
      trialEndsAt,
      currentPeriodStart: now,
      currentPeriodEnd: trialEndsAt,
    },
  });
  await grantEntitlement(tx, { tenantId, planId: plan.id, source: "TRIAL", startsAt: now, endsAt: trialEndsAt });
  return subscription;
}

/**
 * Assinatura vigente do tenant. `plan` = plano EM VIGOR, calculado dos direitos de uso
 * (cobrança paga e conferida, teste grátis ou administrador), nunca do campo da assinatura.
 * `contractedPlan` = plano que a assinatura cobra. Antes de devolver, aplica o que venceu:
 * - trial vencido -> PAST_DUE (inadimplente desde o fim do trial);
 * - cancelada (canceledAt) com o período encerrado -> CANCELED (devolve null).
 */
export async function getCurrentSubscription(tenantId: string, options: { client?: PrismaClient; now?: Date } = {}) {
  const db = forTenant(tenantId, options.client);
  const now = options.now ?? new Date();
  const found = await db.subscription.findFirst({
    where: { status: { not: "CANCELED" } },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  });
  if (!found) return null;
  let subscription = found;

  if (subscription.canceledAt && subscription.currentPeriodEnd <= now) {
    await db.subscription.updateMany({ where: { id: subscription.id }, data: { status: "CANCELED" } });
    return null;
  }

  if (subscription.status === "TRIALING" && subscription.trialEndsAt && subscription.trialEndsAt <= now) {
    await db.subscription.updateMany({
      where: { id: subscription.id, status: "TRIALING" },
      data: { status: "PAST_DUE", pastDueSince: subscription.trialEndsAt },
    });
    subscription = { ...subscription, status: "PAST_DUE", pastDueSince: subscription.trialEndsAt };
  }

  const client = options.client ?? getPrisma();
  // Conta criada antes dos direitos de uso (fase 9): o teste grátis ainda válido ganha o registro.
  // Só o teste (nada pago é criado aqui) e só se a conta não tem NENHUM registro.
  if (subscription.status === "TRIALING" && subscription.trialEndsAt && subscription.trialEndsAt > now) {
    if ((await client.entitlement.count({ where: { tenantId } })) === 0) {
      await grantEntitlement(client, {
        tenantId,
        planId: subscription.planId,
        source: "TRIAL",
        startsAt: subscription.createdAt < now ? subscription.createdAt : now,
        endsAt: subscription.trialEndsAt,
      });
    }
  }
  // Tolerância de atraso só para quem não cancelou.
  const resolved = await resolveEntitlement(client, tenantId, now, { pastDue: !subscription.canceledAt });
  const plan = resolved?.plan ?? (await fallbackPlan(client));
  return {
    ...subscription,
    plan,
    contractedPlan: subscription.plan,
    entitlement: resolved ? { source: resolved.source, endsAt: resolved.endsAt, grace: resolved.grace } : null,
  };
}

/** Operação de sistema (todos os tenants): trials vencidos viram PAST_DUE (inadimplente desde o fim do trial). */
export async function markExpiredTrialsPastDue(client: PrismaClient, now: Date = new Date()) {
  const expired = await client.subscription.findMany({
    where: { status: "TRIALING", trialEndsAt: { lte: now } },
    select: { id: true, trialEndsAt: true },
  });
  for (const s of expired) {
    await client.subscription.updateMany({
      where: { id: s.id, status: "TRIALING" },
      data: { status: "PAST_DUE", pastDueSince: s.trialEndsAt },
    });
  }
  return expired.length;
}
