// Direito de uso dos planos (fase 9). O plano EM VIGOR do cliente é sempre calculado daqui:
// o maior plano com direito válido agora. Nada libera recurso sem um destes registros, e
// estorno/contestação revoga o registro (o plano volta sozinho).
import type { BillingActor, BillingCycle, EntitlementSource, Plan, Prisma, PrismaClient } from "./generated/prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;
const DAY_MS = 86_400_000;

/** Quem já pagou e atrasou mantém o último plano pago por estes dias (depois, envios pausam). */
export const ENTITLEMENT_GRACE_DAYS = 5;

/** Preço do plano no ciclo (mensal/anual). */
export const cyclePrice = (plan: { priceCents: number; annualPriceCents: number }, cycle: BillingCycle) =>
  cycle === "YEARLY" ? plan.annualPriceCents : plan.priceCents;

// ---------- Auditoria ----------

/** Registro na trilha de auditoria da cobrança (sistema: tenantId explícito). */
export function logBilling(
  tx: Tx,
  tenantId: string,
  actor: BillingActor,
  action: string,
  details?: Prisma.InputJsonValue,
  actorUserId?: string | null,
) {
  return tx.billingAuditLog.create({
    data: { tenantId, actor, action, actorUserId: actorUserId ?? null, ...(details === undefined ? {} : { details }) },
  });
}

// ---------- Concessão e revogação ----------

export interface GrantInput {
  tenantId: string;
  planId: string;
  billingCycle?: BillingCycle | null;
  source: EntitlementSource;
  startsAt: Date;
  endsAt: Date;
  asaasPaymentId?: string | null;
}

/** Concede (idempotente por cobrança: a mesma cobrança não gera dois direitos). */
export async function grantEntitlement(tx: Tx, input: GrantInput, actor: BillingActor = "SYSTEM") {
  if (input.asaasPaymentId) {
    const existing = await tx.entitlement.findFirst({ where: { tenantId: input.tenantId, asaasPaymentId: input.asaasPaymentId, revokedAt: null } });
    if (existing) return existing;
  }
  const entitlement = await tx.entitlement.create({
    data: {
      tenantId: input.tenantId,
      planId: input.planId,
      billingCycle: input.billingCycle ?? null,
      source: input.source,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      asaasPaymentId: input.asaasPaymentId ?? null,
    },
  });
  await logBilling(tx, input.tenantId, actor, "entitlement_granted", {
    entitlementId: entitlement.id,
    planId: input.planId,
    source: input.source,
    startsAt: input.startsAt.toISOString(),
    endsAt: input.endsAt.toISOString(),
    asaasPaymentId: input.asaasPaymentId ?? null,
  });
  return entitlement;
}

/** Revoga os direitos comprados por uma cobrança (estorno, contestação). */
export async function revokePaymentEntitlements(tx: Tx, tenantId: string, asaasPaymentId: string, reason: string, now: Date, actor: BillingActor = "ASAAS") {
  const { count } = await tx.entitlement.updateMany({
    where: { tenantId, asaasPaymentId, revokedAt: null },
    data: { revokedAt: now, revokeReason: reason },
  });
  if (count > 0) await logBilling(tx, tenantId, actor, "entitlement_revoked", { asaasPaymentId, reason, count });
  return count;
}

/** Revoga direitos de uma origem (ex.: teste grátis com documento já usado, administrador removido da lista). */
export async function revokeSourceEntitlements(tx: Tx, tenantId: string, source: EntitlementSource, reason: string, now: Date, actor: BillingActor = "SYSTEM") {
  const { count } = await tx.entitlement.updateMany({
    where: { tenantId, source, revokedAt: null, endsAt: { gt: now } },
    data: { revokedAt: now, revokeReason: reason },
  });
  if (count > 0) await logBilling(tx, tenantId, actor, "entitlement_revoked", { source, reason, count });
  return count;
}

// ---------- Plano em vigor ----------

export interface ResolvedEntitlement {
  plan: Plan;
  source: EntitlementSource;
  endsAt: Date;
  /** Dentro da tolerância de atraso (direito pago já vencido). */
  grace: boolean;
}

/**
 * Plano em vigor: o maior plano (Administrador acima de todos) entre os direitos válidos agora.
 * Sem nenhum válido: o último direito PAGO vencido há até 5 dias, se a assinatura está em atraso
 * (tolerância de quem já pagou). Senão, null (sem plano: só o básico, envios pausados).
 */
export async function resolveEntitlement(
  client: Tx,
  tenantId: string,
  now: Date,
  options: { pastDue?: boolean } = {},
): Promise<ResolvedEntitlement | null> {
  const valid = await client.entitlement.findMany({ where: { tenantId, revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } } });
  if (valid.length > 0) {
    const plans = new Map((await client.plan.findMany({ where: { id: { in: [...new Set(valid.map((e) => e.planId))] } } })).map((p) => [p.id, p]));
    const withPlan = valid.flatMap((e) => {
      const plan = plans.get(e.planId);
      return plan ? [{ ...e, plan }] : [];
    });
    if (withPlan.length > 0) {
      const best = withPlan.reduce((a, b) => (rank(b) > rank(a) ? b : a));
      return { plan: best.plan, source: best.source, endsAt: best.endsAt, grace: false };
    }
  }
  if (!options.pastDue) return null;
  const last = await client.entitlement.findFirst({
    where: { tenantId, revokedAt: null, source: "PAYMENT", endsAt: { lte: now, gt: new Date(now.getTime() - ENTITLEMENT_GRACE_DAYS * DAY_MS) } },
    orderBy: { endsAt: "desc" },
  });
  const plan = last ? await client.plan.findUnique({ where: { id: last.planId } }) : null;
  return last && plan ? { plan, source: last.source, endsAt: last.endsAt, grace: true } : null;
}

function rank(e: { source: EntitlementSource; plan: { priceCents: number } }) {
  return e.source === "ADMIN" ? Number.MAX_SAFE_INTEGER : e.plan.priceCents;
}

/** Plano sem direito nenhum: o mais barato à venda, sem números (só catálogo e cópia de mensagem). */
export function fallbackPlan(client: Tx) {
  return client.plan.findFirstOrThrow({
    where: { active: true, code: { not: "admin" }, maxWhatsappNumbers: 0 },
    orderBy: { priceCents: "asc" },
  });
}
