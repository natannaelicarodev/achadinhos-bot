import { parseEncryptionKey } from "@achadinhos/db";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.url({ message: "DATABASE_URL não definida ou inválida no .env." }),
  REDIS_URL: z.url({ message: "REDIS_URL não definida ou inválida no .env." }),
  WHATSAPP_SESSION_KEY: z
    .string({ message: "WHATSAPP_SESSION_KEY não definida no .env." })
    .transform((value, ctx) => {
      try {
        return parseEncryptionKey(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "WHATSAPP_SESSION_KEY inválida: precisa ter 32 bytes em base64." });
        return z.NEVER;
      }
    }),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  // Catálogo central: credenciais DO SISTEMA, usadas só para minerar (nunca para link de cliente).
  CATALOG_MINING_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(60),
  SHOPEE_CATALOG_APP_ID: z.string().min(1).optional(),
  SHOPEE_CATALOG_SECRET: z.string().min(1).optional(),
  AMAZON_CATALOG_CREDENTIAL_ID: z.string().min(1).optional(),
  AMAZON_CATALOG_CREDENTIAL_SECRET: z.string().min(1).optional(),
  AMAZON_CATALOG_PARTNER_TAG: z.string().min(1).optional(),
});

/** No .env, `VAR=""` significa "não definida". */
function withoutEmpty(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== ""),
  );
}

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(withoutEmpty(source));
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `- ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Configuração do worker inválida:\n${problems}`);
  }
  return parsed.data;
}
