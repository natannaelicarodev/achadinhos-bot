import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env";

const valid = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://default:p@localhost:6379",
  WHATSAPP_SESSION_KEY: randomBytes(32).toString("base64"),
};

describe("configuração do worker", () => {
  it("variáveis opcionais vazias no .env (VAR=\"\") contam como não definidas", () => {
    const env = loadEnv({ ...valid, TELEGRAM_BOT_TOKEN: "", LOG_LEVEL: "" });
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("erro diz qual variável corrigir", () => {
    expect(() => loadEnv({ ...valid, REDIS_URL: "" })).toThrow(/REDIS_URL/);
    expect(() => loadEnv({ ...valid, WHATSAPP_SESSION_KEY: "curta" })).toThrow(/WHATSAPP_SESSION_KEY/);
  });
});
