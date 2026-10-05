// Relatórios das lojas (BullMQ job scheduler): vendas da Shopee por grupo de hora em hora.
import { REPORTS_QUEUE, REPORTS_SCHEDULER_ID } from "@achadinhos/jobs";
import type { PrismaClient } from "@achadinhos/db";
import { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { syncShopeeConversions } from "../reports/shopee-conversions";

export const REPORTS_EVERY_MS = 60 * 60_000;

export async function startReports(connection: Redis, deps: { prisma: PrismaClient; logger: Logger }) {
  const queue = new Queue(REPORTS_QUEUE, { connection });
  await queue.upsertJobScheduler(
    REPORTS_SCHEDULER_ID,
    { every: REPORTS_EVERY_MS },
    { name: "shopee-conversions", opts: { removeOnComplete: { count: 20 }, removeOnFail: { count: 20 } } },
  );
  // Ao subir, uma rodada já (os relatórios toleram rodar de novo: só atualizam).
  await queue.add("shopee-conversions", {}, { jobId: `startup-${Math.floor(Date.now() / 600_000)}`, removeOnComplete: true });
  const worker = new Worker(REPORTS_QUEUE, () => syncShopeeConversions(deps), { connection, concurrency: 1 });
  worker.on("failed", (_job, err) => deps.logger.error({ err }, "[relatórios] job falhou"));
  return { queue, worker };
}
