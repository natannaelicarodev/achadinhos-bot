import type { PrismaClient } from "./generated/prisma/client";
import { getCurrentSubscription } from "./subscription";
import { forTenant } from "./tenant";

/** Limite do plano atingido. `message` já vem em pt-BR para o painel. */
export class PlanLimitError extends Error {
  override name = "PlanLimitError";
}

interface Options {
  client?: PrismaClient;
}

async function requirePlan(tenantId: string, options: Options) {
  const subscription = await getCurrentSubscription(tenantId, options);
  if (!subscription) throw new PlanLimitError("Sua conta não tem assinatura ativa.");
  return subscription.plan;
}

/** Uso e limite de números de WhatsApp do tenant. */
export async function getWhatsappUsage(tenantId: string, options: Options = {}) {
  const plan = await requirePlan(tenantId, options);
  const used = await forTenant(tenantId, options.client).channel.count({ where: { type: "WHATSAPP" } });
  return { used, max: plan.maxWhatsappNumbers };
}

/**
 * Antes de criar um número novo. Reconectar um número existente não passa
 * por aqui (não ocupa vaga nova).
 */
export async function assertCanAddWhatsappNumber(tenantId: string, options: Options = {}) {
  const { used, max } = await getWhatsappUsage(tenantId, options);
  if (used >= max) {
    throw new PlanLimitError(
      `Seu plano permite ${max} ${max === 1 ? "número" : "números"} de WhatsApp. Remova um número ou mude de plano.`,
    );
  }
}

/**
 * Antes de conectar um número que já existe: ele precisa estar entre os
 * primeiros N (por data de criação) do plano. Cobre downgrade de plano.
 */
export async function assertChannelWithinWhatsappLimit(tenantId: string, channelId: string, options: Options = {}) {
  const plan = await requirePlan(tenantId, options);
  const allowed = await forTenant(tenantId, options.client).channel.findMany({
    where: { type: "WHATSAPP" },
    orderBy: { createdAt: "asc" },
    take: plan.maxWhatsappNumbers,
    select: { id: true },
  });
  if (!allowed.some((c) => c.id === channelId)) {
    throw new PlanLimitError(
      `Este número passa do limite do seu plano (${plan.maxWhatsappNumbers}). Remova outro número ou mude de plano.`,
    );
  }
}

/** Antes de marcar mais um grupo para receber posts. null em maxGroups = ilimitado. */
export async function assertCanEnableGroupPosting(tenantId: string, options: Options = {}) {
  const plan = await requirePlan(tenantId, options);
  if (plan.maxGroups === null) return;
  const enabled = await forTenant(tenantId, options.client).group.count({ where: { postingEnabled: true } });
  if (enabled >= plan.maxGroups) {
    throw new PlanLimitError(
      `Seu plano permite postar em até ${plan.maxGroups} grupos. Desmarque outro grupo ou mude de plano.`,
    );
  }
}
