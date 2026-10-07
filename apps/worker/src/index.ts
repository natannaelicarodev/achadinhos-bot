import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { getPrisma, recomputeHeadlineKeys, syncAdminAccounts } from "@achadinhos/db";
import { AsaasClient } from "@achadinhos/billing";
import { classifyForCatalog } from "@achadinhos/stores";
import { pino } from "pino";
import { AmazonMiner } from "./catalog/amazon";
import { ShopeeMiner } from "./catalog/shopee";
import { loadEnv } from "./env";
import { startAutopilot } from "./queues/autopilot";
import { startCatalogMining } from "./queues/catalog";
import { startReports } from "./queues/reports";
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

// Contas administradoras (SYSTEM_ADMIN_EMAILS): plano interno "Administrador", sem limites de plano.
void syncAdminAccounts(prisma)
  .then((r) => r.granted.length > 0 && logger.info(r, "[admin] plano Administrador aplicado"))
  .catch((err: unknown) => logger.error({ err }, "[admin] falha ao aplicar o plano Administrador"));

// Headlines: confere o tipo (e a categoria pelo tipo) de todo o catálogo com o dicionário atual.
// Só grava o que mudou; assim uma mudança no dicionário vale no próximo deploy.
void recomputeHeadlineKeys(prisma, (p) => classifyForCatalog(p))
  .then((r) => r.updated > 0 && logger.info(r, "[catálogo] headlines calculadas"))
  .catch((err: unknown) => logger.error({ err }, "[catálogo] falha ao calcular headlines"));

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

// Piloto automático + fila de envio aos grupos (usa os sockets deste worker).
const fast = env.AUTOPILOT_DEV_FAST === "true" && env.NODE_ENV !== "production";
if (fast) logger.warn("[piloto] MODO ACELERADO ligado (AUTOPILOT_DEV_FAST): ritmo e intervalos curtos, só para teste");
const autopilot = await startAutopilot(createRedis(env.REDIS_URL), {
  prisma,
  logger,
  getSocket: (channelId) => manager.getSender(channelId),
  env: {
    ML_AUTOPILOT_ENABLED: env.ML_AUTOPILOT_ENABLED,
    AUTOPILOT_MAX_PRICE_AGE_HOURS: String(env.AUTOPILOT_MAX_PRICE_AGE_HOURS),
  },
  fast,
  // Encurtador /o/ disponível só com TRACKED_LINKS_ENABLED e o domínio de links curtos
  // (SHORT_LINK_BASE_URL, nunca o do painel); cada cliente liga "Contar cliques por grupo".
  ...(env.TRACKED_LINKS_ENABLED === "true" && env.SHORT_LINK_BASE_URL
    ? { shortLinkBase: env.SHORT_LINK_BASE_URL.replace(/\/+$/, "") }
    : {}),
});

// Relatórios das lojas: vendas da Shopee por grupo (credencial de cada cliente).
const reports = await startReports(createRedis(env.REDIS_URL), {
  prisma,
  logger,
  // Cobrança: conferência no Asaas (corrige aviso do webhook que se perdeu).
  asaas: env.ASAAS_API_KEY ? new AsaasClient({ apiKey: env.ASAAS_API_KEY, env: env.ASAAS_ENV }) : null,
});

logger.info({ owner, env: env.NODE_ENV }, "[worker] iniciado");
manager.startAll().catch((err: unknown) => logger.error({ err }, "[worker] falha ao reconectar números"));

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info(`[worker] ${signal} recebido, encerrando`);
  await queueWorker.close().catch(() => undefined);
  await reports.worker.close().catch(() => undefined);
  await reports.queue.close().catch(() => undefined);
  await autopilot.worker.close().catch(() => undefined);
  await autopilot.queue.close().catch(() => undefined);
  await catalog.worker.close().catch(() => undefined);
  await catalog.queue.close().catch(() => undefined);
  await manager.stopAll().catch(() => undefined);
  await redis.quit().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
