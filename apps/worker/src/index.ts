import { env } from "./env";

// Fase 0: stub. Sem conexão real com Redis/BullMQ, WhatsApp (Baileys) ou Telegram (grammY).
console.log(`[worker] iniciado (NODE_ENV=${env.NODE_ENV})`);
console.log(`[worker] DATABASE_URL ${env.DATABASE_URL ? "definida" : "ausente"}`);
console.log(`[worker] REDIS_URL ${env.REDIS_URL ? "definida" : "ausente"}`);

// Mantém o processo vivo até receber sinal de parada.
const heartbeat = setInterval(() => {}, 60_000);

function shutdown(signal: string): void {
  console.log(`[worker] ${signal} recebido, encerrando`);
  clearInterval(heartbeat);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
