import type { ReportsLevel } from "./generated/prisma/enums";

export interface PlanSeed {
  code: string;
  name: string;
  priceCents: number;
  /** Preço do plano anual (cobrança na fase 9). */
  annualPriceCents: number;
  maxWhatsappNumbers: number;
  maxTelegramBots: number;
  maxGroups: number | null; // null = ilimitado
  /** OFERTAS distintas enviadas por dia (1 oferta para 10 grupos conta 1). */
  maxPostsPerDay: number;
  maxUsers: number;
  aiEnabled: boolean;
  /** Legendas com IA por mês (fase 7); null = ilimitado. */
  aiCaptionsPerMonth: number | null;
  reportsLevel: ReportsLevel;
}

/** Cadastro: 7 dias grátis no Iniciante. */
export const TRIAL_PLAN_CODE = "starter";
/** Primeiro plano com números, grupos e envios (o "Catálogo" não tem). */
export const FIRST_SENDING_PLAN_NAME = "Iniciante";

export const PLANS: readonly PlanSeed[] = [
  {
    // Só catálogo, credenciais, conversão de links, "Divulgar link" e mensagem para copiar.
    code: "catalog",
    name: "Catálogo",
    priceCents: 1990,
    annualPriceCents: 19700,
    maxWhatsappNumbers: 0,
    maxTelegramBots: 0,
    maxGroups: 0,
    maxPostsPerDay: 0,
    maxUsers: 1,
    aiEnabled: false,
    aiCaptionsPerMonth: 0,
    reportsLevel: "BASIC",
  },
  {
    code: "starter",
    name: "Iniciante",
    priceCents: 4700,
    annualPriceCents: 46700,
    maxWhatsappNumbers: 1,
    maxTelegramBots: 1,
    maxGroups: 10,
    maxPostsPerDay: 20,
    maxUsers: 1,
    aiEnabled: true,
    aiCaptionsPerMonth: 300,
    reportsLevel: "BASIC",
  },
  {
    code: "pro",
    name: "Pro",
    priceCents: 9700,
    annualPriceCents: 96700,
    maxWhatsappNumbers: 3,
    maxTelegramBots: 3,
    maxGroups: 50,
    maxPostsPerDay: 100,
    maxUsers: 1,
    aiEnabled: true,
    aiCaptionsPerMonth: null,
    reportsLevel: "GROUPS",
  },
  {
    code: "agency",
    name: "Agência",
    priceCents: 19700,
    annualPriceCents: 196700,
    maxWhatsappNumbers: 10,
    maxTelegramBots: 10,
    maxGroups: null,
    maxPostsPerDay: 500,
    maxUsers: 5,
    aiEnabled: true,
    aiCaptionsPerMonth: null,
    reportsLevel: "FULL",
  },
];

/** O plano tem números de WhatsApp, grupos e envios? (o "Catálogo" não tem) */
export const planAllowsSending = (plan: { maxWhatsappNumbers: number }) => plan.maxWhatsappNumbers > 0;

/**
 * Plano interno das contas ADMINISTRADORAS do sistema (SYSTEM_ADMIN_EMAILS): sem limite de
 * plano, relatórios completos. Fica fora de PLANS e com `active: false` (não aparece para
 * clientes nem nos "disponível no plano ..."). Os limites de proteção do WhatsApp por número
 * (aquecimento, mensagens/dia, intervalo entre grupos) continuam valendo.
 */
export const ADMIN_PLAN: PlanSeed & { active: false } = {
  code: "admin",
  name: "Administrador",
  priceCents: 0,
  annualPriceCents: 0,
  maxWhatsappNumbers: 1000,
  maxTelegramBots: 0,
  maxGroups: null,
  maxPostsPerDay: 1_000_000,
  maxUsers: 1000,
  aiEnabled: true,
  aiCaptionsPerMonth: null,
  reportsLevel: "FULL",
  active: false,
};
