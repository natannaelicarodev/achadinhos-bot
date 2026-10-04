import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { getPrisma } from "@achadinhos/db";
import { pino } from "pino";
import { AmazonMiner } from "./catalog/amazon";
import { ShopeeMiner } from "./catalog/shopee";
import { loadEnv } from "./env";
import { startCatalogMining } from "./queues/catalog";
import { startWhatsappQueueWorker } from "./queues/whatsapp";
import { createRedis } from "./redis";
import { ChannelLocks } from "./whatsapp/lock";
import { WhatsAppManager } from "./whatsapp/manager";
import { redisTestSendHistory } from "./whatsapp/rate-limit";

const env = loadEnv();
const logger = pino({ level: env.LOG_LEVEL });

const prisma = getPrisma();
const redis = createRedis(env.REDIS_URL);
const owner = `${hostname()}:${process.pid}:${randomBytes(4).toString("hex")}`;

const manager = new WhatsAppManager({
  prisma,
  redis,
  locks: new ChannelLocks(redis, owner),
  sessionKey: env.WHATSAPP_SESSION_KEY,
  logger,
});

// Antes de ouvir a fila, para não sobrescrever o status de um "conectar" novo.
const interrupted = await manager.resetInterruptedPairings();
if (interrupted > 0) logger.info({ interrupted }, "[worker] pareamentos interrompidos marcados como desconectados");

const queueWorker = startWhatsappQueueWorker(createRedis(env.REDIS_URL), {
  prisma,
  manager,
  history: redisTestSendHistory(redis),
  logger,
});

// Catálogo central: credenciais do SISTEMA, só para minerar.
const catalog = await startCatalogMining(createRedis(env.REDIS_URL), {
  prisma,
  logger,
  intervalMinutes: env.CATALOG_MINING_INTERVAL_MINUTES,
  miners: [
    new ShopeeMiner({ appId: env.SHOPEE_CATALOG_APP_ID, secret: env.SHOPEE_CATALOG_SECRET }),
    new AmazonMiner({
      credentialId: env.AMAZON_CATALOG_CREDENTIAL_ID,
      credentialSecret: env.AMAZON_CATALOG_CREDENTIAL_SECRET,
      partnerTag: env.AMAZON_CATALOG_PARTNER_TAG,
    }),
  ],
});

logger.info({ owner, env: env.NODE_ENV }, "[worker] iniciado");
manager.startAll().catch((err: unknown) => logger.error({ err }, "[worker] falha ao reconectar números"));

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info(`[worker] ${signal} recebido, encerrando`);
  await queueWorker.close().catch(() => undefined);
  await catalog.worker.close().catch(() => undefined);
  await catalog.queue.close().catch(() => undefined);
  await manager.stopAll().catch(() => undefined);
  await redis.quit().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
