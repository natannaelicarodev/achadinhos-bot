// Termos de uso (fase 9). Mudou o texto de forma relevante -> nova versão: todos aceitam de novo.
export const TERMS_VERSION = "2026-10-06";
export const TERMS_DATE_LABEL = "06/10/2026";

/** Quem presta o serviço (preencha no .env antes do lançamento). */
export function termsCompany(env: Record<string, string | undefined> = process.env) {
  return {
    name: env.TERMS_COMPANY_NAME?.trim() || "Achadinhos Bot",
    document: env.TERMS_COMPANY_DOCUMENT?.trim() || null,
    email: env.SUPPORT_EMAIL?.trim() || null,
  };
}
