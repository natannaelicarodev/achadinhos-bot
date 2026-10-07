"use server";

import { cancelPlanChange, cancelSubscription, changePlan, reconcileTenant, subscribe } from "@achadinhos/billing";
import { EMAIL_NOT_VERIFIED_MESSAGE } from "@achadinhos/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/current";
import { rateLimit } from "@/lib/auth/rate-limit";
import { BILLING_NOT_CONFIGURED, billingDeps, billingErrorMessage, getAsaas } from "@/lib/billing";

export type BillingResult = { ok: true; message: string; invoiceUrl?: string | null } | { ok: false; error: string };

const ONLY_OWNER = "Só o dono da conta pode mexer na assinatura.";
const planSchema = z.object({
  planCode: z.string().min(1).max(40),
  cycle: z.enum(["MONTHLY", "YEARLY"]),
});

async function ownerDeps() {
  const { user } = await requireSession();
  if (user.role !== "OWNER") return { error: ONLY_OWNER } as const;
  // Sem e-mail confirmado: não assina, não troca, não cancela (evita conta falsa e cobrança em e-mail errado).
  if (!user.emailVerifiedAt) return { error: EMAIL_NOT_VERIFIED_MESSAGE } as const;
  const asaas = getAsaas();
  if (!asaas) return { error: BILLING_NOT_CONFIGURED } as const;
  if (!rateLimit(`billing:${user.tenantId}`, 10, 60_000)) return { error: "Muitos pedidos seguidos. Espere um minuto." } as const;
  return { user, deps: billingDeps(asaas, { type: "USER", userId: user.id }) } as const;
}

const done = (message: string, invoiceUrl?: string | null): BillingResult => {
  revalidatePath("/painel", "layout");
  return { ok: true, message, ...(invoiceUrl !== undefined ? { invoiceUrl } : {}) };
};

/** Assinar: nome e CPF/CNPJ (o número completo vai só para o Asaas). */
export async function subscribeAction(input: { planCode: string; cycle: string; name: string; document: string }): Promise<BillingResult> {
  const ctx = await ownerDeps();
  if ("error" in ctx) return { ok: false, error: ctx.error! };
  const parsed = planSchema.extend({ name: z.string().trim().max(120), document: z.string().trim().max(30) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };
  try {
    const { invoiceUrl, trialRemoved } = await subscribe(ctx.deps, { tenantId: ctx.user.tenantId, email: ctx.user.email, ...parsed.data });
    const base = invoiceUrl ? "Assinatura criada. Pague a primeira cobrança no Asaas (Pix, boleto ou cartão)." : "Assinatura criada.";
    return done(
      trialRemoved ? `${base} Este CPF/CNPJ já foi usado em outra conta: sem teste grátis, a cobrança vence hoje.` : base,
      invoiceUrl,
    );
  } catch (error) {
    return { ok: false, error: billingErrorMessage(error) };
  }
}

export async function changePlanAction(input: { planCode: string; cycle: string }): Promise<BillingResult> {
  const ctx = await ownerDeps();
  if ("error" in ctx) return { ok: false, error: ctx.error! };
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };
  try {
    const result = await changePlan(ctx.deps, ctx.user.tenantId, parsed.data.planCode, parsed.data.cycle);
    return done(result.message, result.kind === "payment" ? result.invoiceUrl : undefined);
  } catch (error) {
    return { ok: false, error: billingErrorMessage(error) };
  }
}

export async function cancelPlanChangeAction(): Promise<BillingResult> {
  const ctx = await ownerDeps();
  if ("error" in ctx) return { ok: false, error: ctx.error! };
  try {
    await cancelPlanChange(ctx.deps, ctx.user.tenantId);
    return done("Troca de plano cancelada.");
  } catch (error) {
    return { ok: false, error: billingErrorMessage(error) };
  }
}

export async function cancelSubscriptionAction(): Promise<BillingResult> {
  const ctx = await ownerDeps();
  if ("error" in ctx) return { ok: false, error: ctx.error! };
  try {
    const { until } = await cancelSubscription(ctx.deps, ctx.user.tenantId);
    const day = until.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    return done(`Assinatura cancelada: não haverá nova cobrança. Você usa o plano até ${day}.`);
  } catch (error) {
    return { ok: false, error: billingErrorMessage(error) };
  }
}

/** "Atualizar situação": confere as cobranças no Asaas agora (sem esperar o webhook). */
export async function refreshBillingAction(): Promise<BillingResult> {
  const ctx = await ownerDeps();
  if ("error" in ctx) return { ok: false, error: ctx.error! };
  try {
    await reconcileTenant(ctx.deps, ctx.user.tenantId);
    return done("Situação atualizada com o Asaas.");
  } catch (error) {
    return { ok: false, error: billingErrorMessage(error) };
  }
}
