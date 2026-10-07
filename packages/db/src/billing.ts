// Cobrança (fase 9): regras sem rede. Quem fala com o Asaas é o @achadinhos/billing.
// REGRA DE OURO: plano só com direito de uso (Entitlement) criado por cobrança PAGA, conferida
// na API do Asaas, do MESMO cliente, da assinatura atual e com o valor ESPERADO ao centavo.
import { cyclePrice, ENTITLEMENT_GRACE_DAYS, grantEntitlement, logBilling, revokePaymentEntitlements } from "./entitlements";
import { Prisma, type BillingCycle, type PaymentKind, type PrismaClient } from "./generated/prisma/client";
import { getCurrentSubscription } from "./subscription";
import { forTenant } from "./tenant";

/** Quem já pagou e atrasou: envios pausam depois de 5 dias. Sem pagamento confirmado: na hora. */
export const PAST_DUE_GRACE_DAYS = ENTITLEMENT_GRACE_DAYS;

/** Status do Asaas que contam como pago. */
export const PAID_STATUSES = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"] as const;
export const isPaidStatus = (status: string) => (PAID_STATUSES as readonly string[]).includes(status);

/** Estorno ou contestação no cartão: o pagamento deixou de valer. */
export const REVERSED_STATUSES = [
  "REFUNDED",
  "REFUND_REQUESTED",
  "REFUND_IN_PROGRESS",
  "CHARGEBACK_REQUESTED",
  "CHARGEBACK_DISPUTE",
  "AWAITING_CHARGEBACK_REVERSAL",
] as const;
export const isReversedStatus = (status: string) => (REVERSED_STATUSES as readonly string[]).includes(status);

export type SendingBlock =
  | { reason: "EMAIL_NOT_VERIFIED"; message: string }
  | { reason: "NO_SUBSCRIPTION"; message: string }
  | { reason: "TRIAL_ENDED"; message: string }
  | { reason: "PAST_DUE"; message: string };

export const PAYMENT_PENDING_MESSAGE =
  "Envios pausados: pagamento da assinatura pendente. Pague em Assinatura para voltar a enviar (nada foi apagado).";
export const EMAIL_NOT_VERIFIED_MESSAGE = "Confirme o seu e-mail para assinar e enviar aos grupos (o link está na sua caixa de entrada).";

/** O dono da conta confirmou o e-mail? (conta sem usuário, ex.: jobs de sistema, não bloqueia) */
export async function ownerEmailVerified(tenantId: string, client?: PrismaClient): Promise<boolean> {
  const owners = await forTenant(tenantId, client).user.findMany({ where: { role: "OWNER" }, select: { emailVerifiedAt: true } });
  return owners.length === 0 || owners.some((o) => o.emailVerifiedAt !== null);
}

/**
 * Envios pausados? E-mail do dono não confirmado -> pausa. Sem direito de uso válido (teste grátis
 * vencido, nunca pagou, cobrança estornada/contestada, cancelada e vencida) -> pausa. Quem já pagou
 * e atrasou tem até 5 dias de tolerância. Nada é apagado.
 */
export async function getSendingBlock(tenantId: string, options: { client?: PrismaClient; now?: Date } = {}): Promise<SendingBlock | null> {
  const now = options.now ?? new Date();
  if (!(await ownerEmailVerified(tenantId, options.client))) return { reason: "EMAIL_NOT_VERIFIED", message: EMAIL_NOT_VERIFIED_MESSAGE };
  const subscription = await getCurrentSubscription(tenantId, { ...options, now });
  if (!subscription) {
    return { reason: "NO_SUBSCRIPTION", message: "Envios pausados: sua conta não tem assinatura ativa. Escolha um plano em Assinatura." };
  }
  if (subscription.entitlement) return null;
  const paidBefore = await forTenant(tenantId, options.client).entitlement.count({ where: { source: "PAYMENT", revokedAt: null } });
  if (paidBefore === 0) {
    return {
      reason: "TRIAL_ENDED",
      message: "Envios pausados: a assinatura não tem pagamento confirmado. Pague em Assinatura para voltar a enviar (nada foi apagado).",
    };
  }
  return { reason: "PAST_DUE", message: PAYMENT_PENDING_MESSAGE };
}

// ---------- Pagamentos do Asaas ----------

/** Cobrança do Asaas já convertida (centavos e datas), lida DIRETO da API do Asaas. */
export interface BillingPayment {
  id: string;
  customer: string;
  /** Assinatura do Asaas (null = cobrança avulsa, ex.: diferença da troca de plano). */
  subscription: string | null;
  status: string;
  billingType: string | null;
  valueCents: number;
  dueDate: Date;
  paidAt: Date | null;
  invoiceUrl: string | null;
  deleted: boolean;
}

/** "AAAA-MM-DD" do Asaas -> 00:00 de São Paulo. */
export const asaasDate = (day: string) => new Date(`${day}T00:00:00-03:00`);

/** Fim do período pago: vencimento + 1 mês (ou 1 ano). */
export function addCycle(date: Date, cycle: BillingCycle): Date {
  const next = new Date(date);
  if (cycle === "YEARLY") next.setUTCFullYear(next.getUTCFullYear() + 1);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

export type ApplyResult =
  | { ok: false; reason: "UNKNOWN_CUSTOMER" }
  | {
      ok: true;
      tenantId: string;
      /** Upgrade liberado agora: o caller passa a assinatura do Asaas para o valor novo. */
      upgraded: { asaasSubscriptionId: string | null; planId: string; billingCycle: BillingCycle } | null;
      /** Divergência: não liberou nada; avisar os administradores. */
      review: { reason: string; asaasPaymentId: string } | null;
    };

type Tx = Prisma.TransactionClient;

/** Transação serializável com nova tentativa (dois avisos da mesma cobrança ao mesmo tempo). */
export async function serializable<T>(client: PrismaClient, fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
    } catch (error) {
      const retry = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002");
      if (!retry || attempt >= 3) throw error;
    }
  }
}

/**
 * Aplica uma cobrança conferida na API do Asaas (webhook e conferência usam esta função).
 * - Liga a cobrança à conta pelo cliente do Asaas; assinatura de outra conta/antiga = revisão.
 * - Na 1ª vez que vê a cobrança, TRAVA o que ela compra (plano, ciclo, valor esperado).
 * - Paga com valor esperado: cria o direito de uso. Valor diferente: só marca para revisão.
 * - Estorno/contestação: revoga o direito comprado por ela.
 * - Vencida: assinatura em atraso desde o vencimento.
 */
export async function applyAsaasPayment(client: PrismaClient, p: BillingPayment, now: Date = new Date()): Promise<ApplyResult> {
  const tenant = await client.tenant.findUnique({ where: { asaasCustomerId: p.customer }, select: { id: true } });
  if (!tenant) return { ok: false, reason: "UNKNOWN_CUSTOMER" };
  const tenantId = tenant.id;

  return serializable(client, async (tx) => {
    const subscription = await tx.subscription.findFirst({
      where: { tenantId, status: { not: "CANCELED" } },
      orderBy: { createdAt: "desc" },
      include: { plan: true },
    });
    const paid = isPaidStatus(p.status) && !p.deleted;
    const reversed = isReversedStatus(p.status);
    let before = await tx.payment.findUnique({ where: { asaasPaymentId: p.id } });
    if (before && before.tenantId !== tenantId) {
      // Mesmo id de cobrança em outra conta: nunca deveria acontecer. Não mexe em nada.
      return { ok: true as const, tenantId, upgraded: null, review: { reason: "Cobrança ligada a outra conta.", asaasPaymentId: p.id } };
    }

    // O que esta cobrança compra (travado na 1ª vez).
    let kind: PaymentKind = before?.kind ?? (p.subscription ? "SUBSCRIPTION" : "UPGRADE");
    let planId = before?.planId ?? null;
    let billingCycle = before?.billingCycle ?? null;
    let expectedCents = before?.expectedCents ?? null;
    let reviewReason: string | null = before?.reviewReason ?? null;
    if (!before && subscription) {
      if (p.subscription && p.subscription === subscription.asaasSubscriptionId) {
        // Cobrança da assinatura atual: compra o plano escolhido (pendente) ou o contratado.
        const choice = subscription.pendingPlanId && !subscription.pendingPlanPaymentId;
        const billedPlan = await tx.plan.findUniqueOrThrow({ where: { id: choice ? subscription.pendingPlanId! : subscription.planId } });
        const billedCycle = choice && subscription.pendingBillingCycle ? subscription.pendingBillingCycle : subscription.billingCycle;
        kind = "SUBSCRIPTION";
        planId = billedPlan.id;
        billingCycle = billedCycle;
        expectedCents = cyclePrice(billedPlan, billedCycle);
      } else if (p.subscription) {
        kind = "SUBSCRIPTION";
        reviewReason = "Cobrança de uma assinatura que não é a atual desta conta.";
      } else if (subscription.pendingPlanPaymentId === p.id && subscription.pendingPlanId && subscription.pendingAmountCents !== null) {
        // Diferença do upgrade criada pelo sistema: compra o plano novo pelo valor calculado na troca.
        kind = "UPGRADE";
        planId = subscription.pendingPlanId;
        billingCycle = subscription.billingCycle;
        expectedCents = subscription.pendingAmountCents;
      } else {
        kind = "UPGRADE";
        reviewReason = "Cobrança avulsa que o sistema não criou.";
      }
    }
    if (!subscription && !before) reviewReason = "Cobrança de conta sem assinatura.";

    const data = {
      asaasSubscriptionId: p.subscription,
      status: p.deleted ? "DELETED" : p.status,
      billingType: p.billingType,
      valueCents: p.valueCents,
      dueDate: p.dueDate,
      paidAt: paid ? (p.paidAt ?? now) : null,
      invoiceUrl: p.invoiceUrl,
    };
    // Pago com valor diferente do esperado: não libera nada.
    if (paid && !reviewReason && expectedCents !== null && p.valueCents !== expectedCents) {
      reviewReason = `Pago R$ ${(p.valueCents / 100).toFixed(2)} e o esperado era R$ ${(expectedCents / 100).toFixed(2)}.`;
    }
    const newReview = reviewReason !== null && reviewReason !== (before?.reviewReason ?? null);
    if (before) {
      before = await tx.payment.update({ where: { id: before.id }, data: { ...data, reviewReason } });
    } else {
      before = await tx.payment.create({
        data: { tenantId, asaasPaymentId: p.id, ...data, kind, planId, billingCycle, expectedCents, reviewReason },
      });
    }
    if (newReview) await logBilling(tx, tenantId, "SYSTEM", "review_flagged", { asaasPaymentId: p.id, reason: reviewReason });
    const review = newReview ? { reason: reviewReason!, asaasPaymentId: p.id } : null;

    if (reversed) {
      const revoked = await revokePaymentEntitlements(tx, tenantId, p.id, `Cobrança ${p.status}`, now);
      if (subscription && !subscription.canceledAt) {
        await tx.subscription.update({ where: { id: subscription.id }, data: { status: "PAST_DUE", pastDueSince: subscription.pastDueSince ?? p.dueDate } });
      }
      if (revoked > 0 || before.status !== p.status) await logBilling(tx, tenantId, "ASAAS", "payment_reversed", { asaasPaymentId: p.id, status: p.status });
      // Contestação da diferença de um upgrade: o administrador precisa olhar (o Asaas segue cobrando o valor novo).
      if (kind === "UPGRADE" && revoked > 0 && !before.reviewReason) {
        const reason = `Diferença de upgrade ${p.status}: o plano maior foi revogado; confira a assinatura no Asaas.`;
        await tx.payment.update({ where: { id: before.id }, data: { reviewReason: reason } });
        await logBilling(tx, tenantId, "SYSTEM", "review_flagged", { asaasPaymentId: p.id, reason });
        return { ok: true as const, tenantId, upgraded: null, review: { reason, asaasPaymentId: p.id } };
      }
      return { ok: true as const, tenantId, upgraded: null, review };
    }
    if (!subscription || reviewReason) return { ok: true as const, tenantId, upgraded: null, review };

    if (!paid) {
      if (p.status === "OVERDUE" && kind === "SUBSCRIPTION" && !subscription.canceledAt) {
        const since = subscription.pastDueSince && subscription.pastDueSince < p.dueDate ? subscription.pastDueSince : p.dueDate;
        if (subscription.status !== "PAST_DUE" || subscription.pastDueSince?.getTime() !== since.getTime()) {
          await tx.subscription.update({ where: { id: subscription.id }, data: { status: "PAST_DUE", pastDueSince: since } });
          await logBilling(tx, tenantId, "ASAAS", "payment_overdue", { asaasPaymentId: p.id });
        }
      }
      return { ok: true as const, tenantId, upgraded: null, review };
    }

    // ----- Pago, conferido e com o valor esperado -----
    const paidAt = p.paidAt ?? now;
    if (kind === "UPGRADE") {
      if (subscription.pendingPlanPaymentId !== p.id || !planId) return { ok: true as const, tenantId, upgraded: null, review };
      await grantEntitlement(
        tx,
        {
          tenantId,
          planId,
          billingCycle: subscription.billingCycle,
          source: "PAYMENT",
          startsAt: paidAt < now ? paidAt : now,
          endsAt: subscription.currentPeriodEnd,
          asaasPaymentId: p.id,
        },
        "ASAAS",
      );
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { planId, pendingPlanId: null, pendingPlanPaymentId: null, pendingPlanAt: null, pendingBillingCycle: null, pendingAmountCents: null },
      });
      await logBilling(tx, tenantId, "ASAAS", "upgrade_paid", { asaasPaymentId: p.id, planId });
      return {
        ok: true as const,
        tenantId,
        upgraded: { asaasSubscriptionId: subscription.asaasSubscriptionId, planId, billingCycle: subscription.billingCycle },
        review,
      };
    }

    // Assinatura: direito do vencimento até vencimento + ciclo (pago antes do vencimento: vale já).
    const cycle = billingCycle ?? subscription.billingCycle;
    const periodEnd = addCycle(p.dueDate, cycle);
    const already = await tx.entitlement.findFirst({ where: { tenantId, asaasPaymentId: p.id, revokedAt: null } });
    await grantEntitlement(
      tx,
      {
        tenantId,
        planId: planId!,
        billingCycle: cycle,
        source: "PAYMENT",
        startsAt: paidAt < p.dueDate ? paidAt : p.dueDate,
        endsAt: periodEnd,
        asaasPaymentId: p.id,
      },
      "ASAAS",
    );
    const appliesChoice = subscription.pendingPlanId === planId && !subscription.pendingPlanPaymentId;
    await tx.subscription.update({
      where: { id: subscription.id },
      data: {
        status: "ACTIVE",
        pastDueSince: null,
        trialEndsAt: null,
        ...(appliesChoice
          ? { planId: planId!, billingCycle: cycle, pendingPlanId: null, pendingBillingCycle: null, pendingPlanAt: null, pendingAmountCents: null }
          : {}),
        ...(periodEnd > subscription.currentPeriodEnd ? { currentPeriodStart: p.dueDate, currentPeriodEnd: periodEnd } : {}),
      },
    });
    if (!already) await logBilling(tx, tenantId, "ASAAS", "payment_paid", { asaasPaymentId: p.id, planId, valueCents: p.valueCents });
    return { ok: true as const, tenantId, upgraded: null, review };
  });
}

/** Tenta criar a "trava" de operação de cobrança da conta (sem dois cliques simultâneos). */
export async function acquireBillingLock(client: PrismaClient, tenantId: string, now: Date, ttlMs = 60_000): Promise<boolean> {
  const { count } = await client.tenant.updateMany({
    where: { id: tenantId, OR: [{ billingLockUntil: null }, { billingLockUntil: { lt: now } }] },
    data: { billingLockUntil: new Date(now.getTime() + ttlMs) },
  });
  return count === 1;
}

export async function releaseBillingLock(client: PrismaClient, tenantId: string) {
  await client.tenant.updateMany({ where: { id: tenantId }, data: { billingLockUntil: null } });
}
