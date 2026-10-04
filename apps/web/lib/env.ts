import { z } from "zod";

// "" no .env conta como não definido.
const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().default("http://localhost:3000")),
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  SMTP_FROM: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().default("Achadinhos Bot <nao-responda@localhost>"),
  ),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | undefined;

/** Lido sob demanda (não no import), para o build não exigir .env. */
export function getEnv(): ServerEnv {
  cached ??= envSchema.parse(process.env);
  return cached;
}
