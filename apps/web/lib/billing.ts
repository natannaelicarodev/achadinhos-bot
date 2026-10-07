// Cobrança no painel: cliente do Asaas, chave do documento, avisos aos administradores e erros.
import { createHmac } from "node:crypto";
import { asaasFromEnv, AsaasError, BillingError, createMailer, notifyAdminsOfReview, type AsaasClient, type BillingDeps } from "@achadinhos/billing";
import { getPrisma } from "@achadinhos/db";

export const BILLING_NOT_CONFIGURED = "A cobrança ainda não está configurada neste servidor (ASAAS_API_KEY).";

export function getAsaas(): AsaasClient | null {
  return asaasFromEnv();
}

/**
 * Chave da impressão do CPF/CNPJ: BILLING_DOCUMENT_SECRET (produção). Sem ela, derivada da chave das
 * credenciais (STORE_CREDENTIALS_KEY), como a dos cliques: nunca um valor fixo no código.
 */
export function documentSecret(env: Record<string, string | undefined> = process.env): string | undefined {
  const own = env.BILLING_DOCUMENT_SECRET?.trim();
  if (own && own.length >= 16) return own;
  const base = env.STORE_CREDENTIALS_KEY?.trim();
  return base ? createHmac("sha256", base).update("achadinhos:billing-document").digest("hex") : undefined;
}

/** Dependências da cobrança com auditoria de quem agiu e aviso aos administradores por e-mail. */
export function billingDeps(asaas: AsaasClient, actor: BillingDeps["actor"]): BillingDeps {
  const client = getPrisma();
  const send = createMailer();
  const secret = documentSecret();
  return {
    client,
    asaas,
    ...(secret ? { documentSecret: secret } : {}),
    ...(actor ? { actor } : {}),
    notify: async (notice) => {
      await notifyAdminsOfReview(client, send, notice);
    },
  };
}

/** Erro conhecido -> mensagem para o painel; desconhecido -> relança. */
export function billingErrorMessage(error: unknown): string {
  if (error instanceof BillingError || error instanceof AsaasError) return error.message;
  throw error;
}
