"use server";

import { refundPayment } from "@achadinhos/billing";
import { getPrisma, logBilling } from "@achadinhos/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/current";
import { confirmPassword } from "@/lib/auth/reauth";
import { BILLING_NOT_CONFIGURED, billingDeps, billingErrorMessage, getAsaas } from "@/lib/billing";
import { isSystemAdmin } from "@/lib/ml-vitrine";

type Result = { ok: true; message: string } | { ok: false; error: string };

/** Estorno pelo Asaas (administrador confirmado + senha). Opcional: encerrar o acesso (arrependimento). */
export async function refundPaymentAction(input: { paymentId: string; cancelSubscription: boolean; password: string }): Promise<Result> {
  const { user } = await requireSession();
  if (!isSystemAdmin(user)) return { ok: false, error: "Só o administrador do sistema." };
  const parsed = z.object({ paymentId: z.string().min(1).max(100), cancelSubscription: z.boolean(), password: z.string() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };
  const reauth = await confirmPassword(user.id, parsed.data.password);
  if (!reauth.ok) return reauth;
  const asaas = getAsaas();
  if (!asaas) return { ok: false, error: BILLING_NOT_CONFIGURED };
  try {
    await refundPayment(billingDeps(asaas, { type: "ADMIN", userId: user.id }), parsed.data.paymentId, {
      cancelSubscription: parsed.data.cancelSubscription,
    });
    revalidatePath("/painel/admin/cobrancas");
    return {
      ok: true,
      message: parsed.data.cancelSubscription ? "Estorno pedido ao Asaas e acesso encerrado." : "Estorno pedido ao Asaas.",
    };
  } catch (error) {
    return { ok: false, error: billingErrorMessage(error) };
  }
}

/** Revisão feita: tira a marca (o motivo fica na trilha de auditoria). */
export async function resolveReviewAction(input: { paymentId: string; note: string }): Promise<Result> {
  const { user } = await requireSession();
  if (!isSystemAdmin(user)) return { ok: false, error: "Só o administrador do sistema." };
  const parsed = z.object({ paymentId: z.string().min(1).max(100), note: z.string().trim().min(3, "Escreva o que foi feito.").max(500) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  // Operação de sistema (administrador): cobrança de qualquer conta.
  const prisma = getPrisma();
  const payment = await prisma.payment.findUnique({ where: { id: parsed.data.paymentId } });
  if (!payment?.reviewReason) return { ok: false, error: "Esta cobrança não está para revisar." };
  await prisma.payment.update({ where: { id: payment.id }, data: { reviewReason: null } });
  await logBilling(prisma, payment.tenantId, "ADMIN", "review_resolved", { asaasPaymentId: payment.asaasPaymentId, reason: payment.reviewReason, note: parsed.data.note }, user.id);
  revalidatePath("/painel", "layout");
  return { ok: true, message: "Marcada como revisada." };
}
