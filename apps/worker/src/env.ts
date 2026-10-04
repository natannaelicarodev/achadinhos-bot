import { z } from "zod";

// Fase 0: variáveis opcionais. Ficam obrigatórias quando cada integração for ligada.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.url().optional(),
  REDIS_URL: z.url().optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
