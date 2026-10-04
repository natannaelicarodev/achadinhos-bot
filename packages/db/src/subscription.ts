import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { TRIAL_PLAN_CODE } from "./plans";
import { forTenant } from "./tenant";

export const TRIAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

type Tx = Prisma.TransactionClient | PrismaClient;

/** Cria a assinatura de teste (7 dias, plano Iniciante). Usado no cadastro. */
export async function startTrial(tx: Tx, tenantId: string, now: Date = new Date()) {
  const plan = await tx.plan.findUnique({ where: { code: TRIAL_PLAN_CODE } });
  if (!plan) throw new Error(`Plano "${TRIAL_PLAN_CODE}" não encontrado. Rode o seed (pnpm db:seed).`);
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
  return tx.subscription.create({
    data: {
      tenantId,
      planId: plan.id,
      status: "TRIALING",
      trialEndsAt,
      currentPeriodStart: now,
      currentPeriodEnd: trialEndsAt,
    },
  });
}

/**
 * Assinatura vigente do tenant (com plano). Se o trial venceu sem pagamento,
 * passa para PAST_DUE antes de retornar. A pausa dos envios é da fase 9.
 */
export async function getCurrentSubscription(
  tenantId: string,
  options: { client?: PrismaClient; now?: Date } = {},
) {
  const db = forTenant(tenantId, options.client);
  const now = options.now ?? new Date();
  const subscription = await db.subscription.findFirst({
    where: { status: { not: "CANCELED" } },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  });
  if (!subscription) return null;

  if (subscription.status === "TRIALING" && subscription.trialEndsAt && subscription.trialEndsAt <= now) {
    await db.subscription.updateMany({
      where: { id: subscription.id, status: "TRIALING" },
      data: { status: "PAST_DUE" },
    });
    return { ...subscription, status: "PAST_DUE" as const };
  }
  return subscription;
}

/** Operação de sistema (todos os tenants): trials vencidos viram PAST_DUE. */
export async function markExpiredTrialsPastDue(client: PrismaClient, now: Date = new Date()) {
  const { count } = await client.subscription.updateMany({
    where: { status: "TRIALING", trialEndsAt: { lte: now } },
    data: { status: "PAST_DUE" },
  });
  return count;
}
