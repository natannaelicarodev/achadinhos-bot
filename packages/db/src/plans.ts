import type { ReportsLevel } from "./generated/prisma/enums";

export interface PlanSeed {
  code: string;
  name: string;
  priceCents: number;
  maxWhatsappNumbers: number;
  maxTelegramBots: number;
  maxGroups: number | null; // null = ilimitado
  maxPostsPerDay: number;
  maxUsers: number;
  aiEnabled: boolean;
  reportsLevel: ReportsLevel;
}

export const TRIAL_PLAN_CODE = "starter";

export const PLANS: readonly PlanSeed[] = [
  {
    code: "starter",
    name: "Iniciante",
    priceCents: 7990,
    maxWhatsappNumbers: 1,
    maxTelegramBots: 1,
    maxGroups: 10,
    maxPostsPerDay: 40,
    maxUsers: 1,
    aiEnabled: true,
    reportsLevel: "BASIC",
  },
  {
    code: "pro",
    name: "Pro",
    priceCents: 14990,
    maxWhatsappNumbers: 3,
    maxTelegramBots: 3,
    maxGroups: 50,
    maxPostsPerDay: 150,
    maxUsers: 1,
    aiEnabled: true,
    reportsLevel: "GROUPS",
  },
  {
    code: "agency",
    name: "Agência",
    priceCents: 29700,
    maxWhatsappNumbers: 10,
    maxTelegramBots: 10,
    maxGroups: null,
    maxPostsPerDay: 500,
    maxUsers: 5,
    aiEnabled: true,
    reportsLevel: "FULL",
  },
];
