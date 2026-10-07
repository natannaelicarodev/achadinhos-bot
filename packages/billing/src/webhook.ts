// Webhook do Asaas: confere o token, processa cada evento uma vez só e aplica a cobrança.
import { createHash, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@achadinhos/db";
import { z } from "zod";
import { asaasPaymentSchema, type AsaasClient } from "./asaas";
import { syncPayment, type BillingNotice } from "./flows";

/** Corpo do webhook (eventos de cobrança: PAYMENT_*). */
export const webhookEventSchema = z.object({
  id: z.string().min(1).max(200),
  event: z.string().min(1).max(100),
  payment: asaasPaymentSchema.optional(),
});

/** Header `asaas-access-token` igual ao ASAAS_WEBHOOK_TOKEN (comparação em tempo constante). */
export function isValidWebhookToken(header: string | null, expected: string | undefined): boolean {
  const secret = expected?.trim();
  if (!header || !secret || secret.length < 16) return false;
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

export type WebhookOutcome = "processed" | "duplicate" | "ignored" | "unknown-customer" | "not-configured";

/**
 * Processa um evento. Repetido (o Asaas reenvia) não é aplicado de novo.
 * Erro -> o evento fica sem processedAt e o erro é lançado (o Asaas tenta de novo).
 */
export async function handleWebhookEvent(
  deps: { client: PrismaClient; asaas: AsaasClient | null; now?: Date; notify?: (notice: BillingNotice) => Promise<void> },
  event: z.infer<typeof webhookEventSchema>,
): Promise<WebhookOutcome> {
  const existing = await deps.client.asaasWebhookEvent.findUnique({ where: { id: event.id } });
  if (existing?.processedAt) return "duplicate";
  if (!existing) {
    await deps.client.asaasWebhookEvent.create({ data: { id: event.id, event: event.event, asaasPaymentId: event.payment?.id ?? null } });
  }
  if (!event.event.startsWith("PAYMENT_") || !event.payment) {
    await deps.client.asaasWebhookEvent.update({ where: { id: event.id }, data: { processedAt: deps.now ?? new Date() } });
    return "ignored";
  }
  // Sem a chave de API não dá para conferir a cobrança na API do Asaas: não aplica nada.
  if (!deps.asaas) {
    await deps.client.asaasWebhookEvent.update({ where: { id: event.id }, data: { error: "ASAAS_API_KEY ausente: aviso não conferido." } });
    return "not-configured";
  }
  try {
    // NUNCA usa o corpo do aviso direto: lê a cobrança de novo na API do Asaas (verify).
    const result = await syncPayment(
      { client: deps.client, asaas: deps.asaas, actor: { type: "ASAAS" }, ...(deps.now ? { now: deps.now } : {}), ...(deps.notify ? { notify: deps.notify } : {}) },
      event.payment,
      { verify: true },
    );
    await deps.client.asaasWebhookEvent.update({ where: { id: event.id }, data: { processedAt: deps.now ?? new Date(), error: null } });
    return result.ok ? "processed" : "unknown-customer";
  } catch (error) {
    await deps.client.asaasWebhookEvent.update({
      where: { id: event.id },
      data: { error: (error instanceof Error ? error.message : "erro").slice(0, 500) },
    });
    throw error;
  }
}
