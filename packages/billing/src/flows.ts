// Fluxos da cobrança: assinar, trocar de plano, cancelar, conferir e estornar.
// Regras de rigidez (fase 9):
// - toda operação da conta passa por uma TRAVA (dois cliques não criam duas assinaturas);
// - plano só muda com cobrança PAGA e conferida (applyAsaasPayment + direito de uso);
// - aviso do Asaas nunca é usado direto: a cobrança é lida de novo na API (syncPayment verify);
// - assinatura "órfã" no Asaas (cobraria em dobro) é cancelada na conferência;
// - CPF/CNPJ já usado em outra conta não ganha teste grátis;
// - tudo vai para a trilha de auditoria (BillingAuditLog).
import {
  acquireBillingLock,
  ADMIN_PLAN,
  applyAsaasPayment,
  asaasDate,
  cyclePrice,
  forTenant,
  getCurrentSubscription,
  isPaidStatus,
  logBilling,
  releaseBillingLock,
  revokeSourceEntitlements,
  type ApplyResult,
  type BillingActor,
  type BillingCycle,
  type BillingPayment,
  type PrismaClient,
} from "@achadinhos/db";
import type { AsaasClient, AsaasPayment } from "./asaas";
import { documentFingerprint, documentLast4, parseDocument } from "./document";
import { asaasDay, centsToValue, MIN_CHARGE_CENTS, upgradeDifferenceCents, valueToCents } from "./pricing";

export class BillingError extends Error {
  override name = "BillingError";
}

/** Aviso para os administradores (ex.: valor pago diferente do esperado). */
export interface BillingNotice {
  kind: "review";
  tenantId: string;
  asaasPaymentId: string;
  reason: string;
}

export interface BillingDeps {
  client: PrismaClient;
  asaas: AsaasClient;
  now?: Date;
  /** Chave da impressão do CPF/CNPJ (obrigatória para assinar). */
  documentSecret?: string;
  /** Quem está agindo (auditoria). */
  actor?: { type: BillingActor; userId?: string | null };
  /** Avisa os administradores (e-mail). Erro no aviso não desfaz a cobrança. */
  notify?: (notice: BillingNotice) => Promise<void>;
}

const CYCLE_LABEL: Record<BillingCycle, string> = { MONTHLY: "mensal", YEARLY: "anual" };
const DAY_MS = 86_400_000;
const nowOf = (deps: BillingDeps) => deps.now ?? new Date();
const actorOf = (deps: BillingDeps) => deps.actor ?? { type: "SYSTEM" as const, userId: null };

/** Cobrança do Asaas -> formato do banco. */
export function toBillingPayment(p: AsaasPayment): BillingPayment {
  const paidDay = p.paymentDate ?? p.clientPaymentDate ?? p.confirmedDate ?? null;
  return {
    id: p.id,
    customer: p.customer,
    subscription: p.subscription ?? null,
    status: p.status,
    billingType: p.billingType ?? null,
    valueCents: valueToCents(p.value),
    dueDate: asaasDate(p.dueDate),
    paidAt: paidDay && isPaidStatus(p.status) ? asaasDate(paidDay) : null,
    invoiceUrl: p.invoiceUrl ?? null,
    deleted: p.deleted ?? false,
  };
}

/**
 * Grava a cobrança e aplica as regras. `verify`: lê a cobrança de novo na API do Asaas antes
 * (obrigatório para o que vem do webhook: um aviso forjado não libera nada).
 */
export async function syncPayment(deps: BillingDeps, payment: AsaasPayment, options: { verify?: boolean } = {}): Promise<ApplyResult> {
  const fresh = options.verify ? await deps.asaas.getPayment(payment.id) : payment;
  if (options.verify && fresh.customer !== payment.customer) {
    throw new BillingError("O aviso do Asaas não confere com a cobrança na API (cliente diferente).");
  }
  const result = await applyAsaasPayment(deps.client, toBillingPayment(fresh), nowOf(deps));
  if (result.ok && result.upgraded?.asaasSubscriptionId) {
    const plan = await deps.client.plan.findUniqueOrThrow({ where: { id: result.upgraded.planId } });
    await deps.asaas.updateSubscriptionValue(result.upgraded.asaasSubscriptionId, centsToValue(cyclePrice(plan, result.upgraded.billingCycle)));
  }
  if (result.ok && result.review && deps.notify) {
    await deps.notify({ kind: "review", tenantId: result.tenantId, ...result.review }).catch(() => undefined);
  }
  return result;
}

/** Roda a operação com a trava da conta (sem duas operações de cobrança ao mesmo tempo). */
async function withLock<T>(deps: BillingDeps, tenantId: string, fn: () => Promise<T>): Promise<T> {
  if (!(await acquireBillingLock(deps.client, tenantId, nowOf(deps)))) {
    throw new BillingError("Já existe uma operação de cobrança em andamento nesta conta. Aguarde alguns segundos.");
  }
  try {
    return await fn();
  } finally {
    await releaseBillingLock(deps.client, tenantId);
  }
}

const audit = (deps: BillingDeps, tenantId: string, action: string, details?: Record<string, unknown>) =>
  logBilling(deps.client, tenantId, actorOf(deps).type, action, details as never, actorOf(deps).userId ?? null);

async function sellablePlan(client: PrismaClient, code: string) {
  const plan = await client.plan.findUnique({ where: { code } });
  if (!plan || !plan.active || plan.code === ADMIN_PLAN.code) throw new BillingError("Plano inválido.");
  return plan;
}

const description = (planName: string, cycle: BillingCycle) => `Achadinhos Bot - plano ${planName} (${CYCLE_LABEL[cycle]})`;

/** Primeira cobrança pendente da assinatura (para o botão "Pagar agora"). */
async function firstOpenInvoice(deps: BillingDeps, customer: string, asaasSubscriptionId: string) {
  const payments = await deps.asaas.listCustomerPayments(customer, 1);
  const mine = payments.filter((p) => p.subscription === asaasSubscriptionId);
  for (const p of mine) await syncPayment(deps, p);
  return mine.find((p) => !isPaidStatus(p.status) && !p.deleted)?.invoiceUrl ?? null;
}

export interface SubscribeInput {
  tenantId: string;
  planCode: string;
  cycle: BillingCycle;
  name: string;
  document: string;
  email: string;
}

/**
 * Assinar: cria o cliente no Asaas (o CPF/CNPJ completo vai só para lá; aqui ficam os 4 últimos e
 * a impressão irreversível) e a assinatura recorrente. O plano escolhido fica PENDENTE e só vale
 * quando a cobrança for paga. Documento já usado em outra conta: sem teste grátis (vence hoje).
 */
export async function subscribe(deps: BillingDeps, input: SubscribeInput): Promise<{ invoiceUrl: string | null; trialRemoved: boolean }> {
  return withLock(deps, input.tenantId, async () => {
    const now = nowOf(deps);
    const { client, asaas } = deps;
    const plan = await sellablePlan(client, input.planCode);
    const db = forTenant(input.tenantId, client);
    const current = await getCurrentSubscription(input.tenantId, { client, now });
    if (current?.contractedPlan.code === ADMIN_PLAN.code) throw new BillingError("Conta administradora: sem cobrança.");
    if (current?.asaasSubscriptionId && !current.canceledAt) throw new BillingError("Você já tem uma assinatura. Use \"Trocar de plano\".");

    const tenant = await client.tenant.findUniqueOrThrow({ where: { id: input.tenantId } });
    let customer = tenant.asaasCustomerId;
    let trialRemoved = false;
    if (!customer) {
      const document = parseDocument(input.document);
      if (!document) throw new BillingError("CPF ou CNPJ inválido.");
      const name = input.name.trim();
      if (name.length < 3) throw new BillingError("Informe o nome completo ou a razão social.");
      if (!deps.documentSecret) throw new BillingError("Cobrança sem a chave do documento (BILLING_DOCUMENT_SECRET).");
      const fingerprint = documentFingerprint(document, deps.documentSecret);
      // Mesmo CPF/CNPJ em outra conta: o teste grátis desta conta acaba agora.
      const reused = await client.tenant.count({ where: { billingDocumentHash: fingerprint, id: { not: input.tenantId } } });
      customer = (await asaas.createCustomer({ name, cpfCnpj: document, email: input.email, externalReference: input.tenantId })).id;
      await client.tenant.update({
        where: { id: input.tenantId },
        data: { asaasCustomerId: customer, billingName: name, billingDocumentLast4: documentLast4(document), billingDocumentHash: fingerprint },
      });
      await audit(deps, input.tenantId, "customer_created", { asaasCustomerId: customer, documentLast4: documentLast4(document) });
      if (reused > 0 && current?.status === "TRIALING") {
        await revokeSourceEntitlements(client, input.tenantId, "TRIAL", "CPF/CNPJ já usado em outra conta.", now);
        await db.subscription.update({ where: { id: current.id }, data: { trialEndsAt: now, status: "PAST_DUE", pastDueSince: now } });
        trialRemoved = true;
      }
    }

    const inTrial = !trialRemoved && current?.status === "TRIALING" && current.trialEndsAt && current.trialEndsAt > now;
    const firstDue = inTrial ? current.trialEndsAt! : now;
    const created = await asaas.createSubscription({
      customer,
      value: centsToValue(cyclePrice(plan, input.cycle)),
      nextDueDate: asaasDay(firstDue),
      cycle: input.cycle,
      description: description(plan.name, input.cycle),
      externalReference: input.tenantId,
    });

    const data = {
      asaasSubscriptionId: created.id,
      canceledAt: null,
      pendingPlanId: plan.id,
      pendingBillingCycle: input.cycle,
      pendingPlanAt: null,
      pendingPlanPaymentId: null,
      pendingAmountCents: null,
    };
    if (current) {
      await db.subscription.update({
        where: { id: current.id },
        data: inTrial ? data : { ...data, status: "PAST_DUE", pastDueSince: current.pastDueSince ?? now },
      });
    } else {
      await db.subscription.create({
        data: {
          tenantId: input.tenantId,
          planId: plan.id,
          billingCycle: input.cycle,
          ...data,
          status: "PAST_DUE",
          pastDueSince: now,
          currentPeriodStart: now,
          currentPeriodEnd: now,
        },
      });
    }
    await audit(deps, input.tenantId, "subscribe", { planCode: plan.code, cycle: input.cycle, asaasSubscriptionId: created.id, firstDue: asaasDay(firstDue), trialRemoved });
    return { invoiceUrl: await firstOpenInvoice(deps, customer, created.id), trialRemoved };
  });
}

export type ChangeResult =
  | { kind: "now"; message: string }
  | { kind: "scheduled"; at: Date; message: string }
  | { kind: "payment"; invoiceUrl: string | null; message: string };

/**
 * Trocar de plano. REGRA: plano mais caro (ou ciclo novo) só vale com pagamento confirmado.
 * - nunca pagou: muda a escolha; vale quando a 1ª cobrança for paga;
 * - mensal <-> anual: assinatura nova no Asaas (1º vencimento no fim do período pago); vale quando ela for paga;
 * - subir: cobrança avulsa da diferença proporcional (valor travado); o plano libera quando ela for paga
 *   (diferença abaixo do mínimo do Asaas: começa no próximo vencimento, quando ele for pago);
 * - descer: valor novo no Asaas já; o plano menor vale com a próxima cobrança paga (o maior segue até o fim do pago).
 */
export async function changePlan(deps: BillingDeps, tenantId: string, planCode: string, cycle: BillingCycle): Promise<ChangeResult> {
  return withLock(deps, tenantId, async () => {
    const now = nowOf(deps);
    const { client, asaas } = deps;
    const plan = await sellablePlan(client, planCode);
    const db = forTenant(tenantId, client);
    const current = await getCurrentSubscription(tenantId, { client, now });
    if (!current?.asaasSubscriptionId || current.canceledAt) throw new BillingError("Escolha um plano para assinar primeiro.");
    const tenant = await client.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const customer = tenant.asaasCustomerId!;
    const paidBefore = (await db.entitlement.count({ where: { source: "PAYMENT", revokedAt: null } })) > 0;
    const newValue = centsToValue(cyclePrice(plan, cycle));
    if (paidBefore && current.pendingPlanId) {
      throw new BillingError("Já existe uma troca de plano em andamento. Desista da troca antes de pedir outra.");
    }
    const chosenPlanId = !paidBefore && current.pendingPlanId ? current.pendingPlanId : current.planId;
    const chosenCycle = !paidBefore && current.pendingBillingCycle ? current.pendingBillingCycle : current.billingCycle;
    if (chosenPlanId === plan.id && chosenCycle === cycle) throw new BillingError("Este já é o plano escolhido.");
    const log = (mode: string, extra: Record<string, unknown> = {}) =>
      audit(deps, tenantId, "change_plan", { mode, planCode: plan.code, cycle, ...extra });

    if (!paidBefore) {
      const pending = { pendingPlanId: plan.id, pendingBillingCycle: cycle, pendingPlanAt: null, pendingPlanPaymentId: null, pendingAmountCents: null };
      if (cycle !== chosenCycle) {
        await asaas.deleteSubscription(current.asaasSubscriptionId);
        const firstDue = current.status === "TRIALING" && current.trialEndsAt && current.trialEndsAt > now ? current.trialEndsAt : now;
        const created = await asaas.createSubscription({
          customer,
          value: newValue,
          nextDueDate: asaasDay(firstDue),
          cycle,
          description: description(plan.name, cycle),
          externalReference: tenantId,
        });
        await db.subscription.update({ where: { id: current.id }, data: { asaasSubscriptionId: created.id, ...pending } });
        await firstOpenInvoice(deps, customer, created.id);
      } else {
        await asaas.updateSubscriptionValue(current.asaasSubscriptionId, newValue);
        await db.subscription.update({ where: { id: current.id }, data: pending });
      }
      await log("choice_before_payment");
      return {
        kind: "scheduled",
        at: current.trialEndsAt ?? now,
        message: `Plano ${plan.name} escolhido: a cobrança já sai com o valor novo e o plano libera quando ela for paga.`,
      };
    }

    if (cycle !== current.billingCycle) {
      await asaas.deleteSubscription(current.asaasSubscriptionId);
      const created = await asaas.createSubscription({
        customer,
        value: newValue,
        nextDueDate: asaasDay(current.currentPeriodEnd),
        cycle,
        description: description(plan.name, cycle),
        externalReference: tenantId,
      });
      await db.subscription.update({
        where: { id: current.id },
        data: { asaasSubscriptionId: created.id, pendingPlanId: plan.id, pendingBillingCycle: cycle, pendingPlanAt: null, pendingAmountCents: null },
      });
      await log("cycle_change", { newAsaasSubscriptionId: created.id });
      return {
        kind: "scheduled",
        at: current.currentPeriodEnd,
        message: `Troca para o plano ${plan.name} (${CYCLE_LABEL[cycle]}): a nova cobrança vence no fim do período pago e o plano muda quando ela for paga.`,
      };
    }

    const currentPrice = cyclePrice(current.contractedPlan, cycle);
    const newPrice = cyclePrice(plan, cycle);
    if (newPrice > currentPrice) {
      const diff = upgradeDifferenceCents(currentPrice, newPrice, current.currentPeriodStart, current.currentPeriodEnd, now);
      if (diff < MIN_CHARGE_CENTS) {
        await asaas.updateSubscriptionValue(current.asaasSubscriptionId, newValue);
        await db.subscription.update({
          where: { id: current.id },
          data: { pendingPlanId: plan.id, pendingBillingCycle: cycle, pendingPlanAt: null, pendingAmountCents: null },
        });
        await log("upgrade_next_due", { diffCents: diff });
        return {
          kind: "scheduled",
          at: current.currentPeriodEnd,
          message: `O plano ${plan.name} começa no próximo vencimento, quando a cobrança (já com o valor novo) for paga.`,
        };
      }
      // Valor da diferença travado ANTES de criar a cobrança: pago com outro valor não libera.
      await db.subscription.update({ where: { id: current.id }, data: { pendingPlanId: plan.id, pendingAmountCents: diff, pendingPlanAt: null } });
      const payment = await asaas.createPayment({
        customer,
        value: centsToValue(diff),
        dueDate: asaasDay(new Date(now.getTime() + 3 * DAY_MS)),
        description: `Achadinhos Bot - diferença para o plano ${plan.name} até ${asaasDay(current.currentPeriodEnd).split("-").reverse().join("/")}`,
        externalReference: tenantId,
      });
      await db.subscription.update({ where: { id: current.id }, data: { pendingPlanPaymentId: payment.id } });
      await syncPayment(deps, payment);
      await log("upgrade_charge", { asaasPaymentId: payment.id, diffCents: diff });
      return {
        kind: "payment",
        invoiceUrl: payment.invoiceUrl ?? null,
        message: `Pague a diferença deste período para liberar o plano ${plan.name}. Depois, a assinatura passa a cobrar o valor novo.`,
      };
    }

    await asaas.updateSubscriptionValue(current.asaasSubscriptionId, newValue);
    await db.subscription.update({
      where: { id: current.id },
      data: { pendingPlanId: plan.id, pendingBillingCycle: cycle, pendingPlanAt: current.currentPeriodEnd, pendingAmountCents: null },
    });
    await log("downgrade");
    return { kind: "scheduled", at: current.currentPeriodEnd, message: `Troca para o plano ${plan.name} agendada para o próximo vencimento.` };
  });
}

/** Desiste da troca de plano pendente (apaga a cobrança da diferença e volta o valor). */
export async function cancelPlanChange(deps: BillingDeps, tenantId: string) {
  return withLock(deps, tenantId, async () => {
    const db = forTenant(tenantId, deps.client);
    const current = await getCurrentSubscription(tenantId, { client: deps.client, now: nowOf(deps) });
    if (!current?.pendingPlanId) throw new BillingError("Não há troca de plano em andamento.");
    if (current.pendingBillingCycle && current.pendingBillingCycle !== current.billingCycle && !current.pendingPlanAt) {
      throw new BillingError("A troca entre mensal e anual já criou a nova assinatura no Asaas; para desfazer, troque de novo depois do vencimento.");
    }
    if ((await db.entitlement.count({ where: { source: "PAYMENT", revokedAt: null } })) === 0) {
      throw new BillingError("O plano escolhido só vale depois do pagamento. Para mudar, escolha outro plano.");
    }
    if (current.pendingPlanPaymentId) await deps.asaas.deletePayment(current.pendingPlanPaymentId);
    else if (current.asaasSubscriptionId) {
      await deps.asaas.updateSubscriptionValue(current.asaasSubscriptionId, centsToValue(cyclePrice(current.contractedPlan, current.billingCycle)));
    }
    await db.subscription.update({
      where: { id: current.id },
      data: { pendingPlanId: null, pendingBillingCycle: null, pendingPlanAt: null, pendingPlanPaymentId: null, pendingAmountCents: null },
    });
    await audit(deps, tenantId, "change_plan_canceled", { asaasPaymentId: current.pendingPlanPaymentId });
  });
}

/** Cancelar: o Asaas para de cobrar na hora; o cliente usa até o fim do período pago. */
export async function cancelSubscription(deps: BillingDeps, tenantId: string, options: { lock?: boolean } = {}) {
  const run = async () => {
    const now = nowOf(deps);
    const db = forTenant(tenantId, deps.client);
    const current = await getCurrentSubscription(tenantId, { client: deps.client, now });
    if (!current || current.contractedPlan.code === ADMIN_PLAN.code) throw new BillingError("Não há assinatura para cancelar.");
    if (current.canceledAt) throw new BillingError("A assinatura já está cancelada.");
    if (current.asaasSubscriptionId) await deps.asaas.deleteSubscription(current.asaasSubscriptionId);
    if (current.pendingPlanPaymentId) await deps.asaas.deletePayment(current.pendingPlanPaymentId).catch(() => undefined);
    // O acesso vai até o fim do direito de uso que já existe (pago ou teste); nada novo é criado.
    const until = current.entitlement && !current.entitlement.grace ? current.entitlement.endsAt : now;
    await db.subscription.update({
      where: { id: current.id },
      data: {
        canceledAt: now,
        currentPeriodEnd: until,
        pendingPlanId: null,
        pendingBillingCycle: null,
        pendingPlanAt: null,
        pendingPlanPaymentId: null,
        pendingAmountCents: null,
      },
    });
    await audit(deps, tenantId, "cancel", { until: until.toISOString() });
    return { until };
  };
  return options.lock === false ? run() : withLock(deps, tenantId, run);
}

/**
 * Conferência: busca no Asaas as cobranças do cliente e aplica (corrige webhook perdido) e cancela
 * assinatura "órfã" (ativa no Asaas, mas que não é a atual desta conta: cobraria em dobro).
 */
export async function reconcileTenant(deps: BillingDeps, tenantId: string) {
  const tenant = await deps.client.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (!tenant.asaasCustomerId) return { payments: 0, orphans: 0 };
  const current = await deps.client.subscription.findFirst({
    where: { tenantId, status: { not: "CANCELED" } },
    orderBy: { createdAt: "desc" },
  });
  const keep = current && !current.canceledAt ? current.asaasSubscriptionId : null;
  let orphans = 0;
  for (const sub of await deps.asaas.listCustomerSubscriptions(tenant.asaasCustomerId)) {
    if (sub.deleted || (sub.status && sub.status !== "ACTIVE") || sub.id === keep) continue;
    await deps.asaas.deleteSubscription(sub.id);
    await logBilling(deps.client, tenantId, "SYSTEM", "orphan_subscription_canceled", { asaasSubscriptionId: sub.id });
    orphans += 1;
  }
  const payments = await deps.asaas.listCustomerPayments(tenant.asaasCustomerId);
  // Mais antigas primeiro: o período termina no vencimento mais recente pago.
  payments.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  for (const p of payments) await syncPayment(deps, p);
  return { payments: payments.length, orphans };
}

/** Conferência de todos os clientes com cadastro no Asaas (worker, de hora em hora). */
export async function reconcileAll(deps: BillingDeps) {
  const tenants = await deps.client.tenant.findMany({ where: { asaasCustomerId: { not: null } }, select: { id: true } });
  let failed = 0;
  let orphans = 0;
  for (const t of tenants) {
    try {
      orphans += (await reconcileTenant(deps, t.id)).orphans;
    } catch {
      failed += 1;
    }
  }
  return { tenants: tenants.length, failed, orphans };
}

/** Estorno (administrador): devolve a cobrança no Asaas e, se pedido, encerra o acesso (arrependimento). */
export async function refundPayment(deps: BillingDeps, paymentId: string, options: { cancelSubscription: boolean }) {
  const payment = await deps.client.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new BillingError("Cobrança não encontrada.");
  if (!payment.paidAt) throw new BillingError("Só dá para estornar cobrança paga.");
  return withLock(deps, payment.tenantId, async () => {
    const refunded = await deps.asaas.refundPayment(payment.asaasPaymentId, "Estorno pelo Achadinhos Bot (direito de arrependimento / suporte)");
    await audit(deps, payment.tenantId, "refund", { asaasPaymentId: payment.asaasPaymentId, cancelSubscription: options.cancelSubscription });
    await syncPayment(deps, refunded);
    if (options.cancelSubscription) {
      await cancelSubscription(deps, payment.tenantId, { lock: false }).catch((error: unknown) => {
        if (!(error instanceof BillingError)) throw error;
      });
      // Arrependimento: o acesso pago termina junto com o estorno.
      await forTenant(payment.tenantId, deps.client).subscription.updateMany({
        where: { canceledAt: { not: null }, status: { not: "CANCELED" } },
        data: { currentPeriodEnd: nowOf(deps) },
      });
    }
  });
}
