// Relatórios das lojas (BullMQ job scheduler): vendas da Shopee por grupo de hora em hora.
// Mesma fila: conferência das cobranças no Asaas (fase 9), também de hora em hora.
import { REPORTS_QUEUE, REPORTS_SCHEDULER_ID } from "@achadinhos/jobs";
import { createMailer, notifyAdminsOfReview, reconcileAll, type AsaasClient } from "@achadinhos/billing";
import type { PrismaClient } from "@achadinhos/db";
import { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { syncShopeeConversions } from "../reports/shopee-conversions";

export const REPORTS_EVERY_MS = 60 * 60_000;

const BILLING_SCHEDULER_ID = "billing-reconcile";

export async function startReports(connection: Redis, deps: { prisma: PrismaClient; logger: Logger; asaas: AsaasClient | null }) {
  const queue = new Queue(REPORTS_QUEUE, { connection });
  await queue.upsertJobScheduler(
    REPORTS_SCHEDULER_ID,
    { every: REPORTS_EVERY_MS },
    { name: "shopee-conversions", opts: { removeOnComplete: { count: 20 }, removeOnFail: { count: 20 } } },
  );
  // Ao subir, uma rodada já (os relatórios toleram rodar de novo: só atualizam).
  await queue.add("shopee-conversions", {}, { jobId: `startup-${Math.floor(Date.now() / 600_000)}`, removeOnComplete: true });
  const asaas = deps.asaas;
  if (asaas) {
    await queue.upsertJobScheduler(
      BILLING_SCHEDULER_ID,
      { every: REPORTS_EVERY_MS },
      { name: "billing-reconcile", opts: { removeOnComplete: { count: 20 }, removeOnFail: { count: 20 } } },
    );
  } else {
    await queue.removeJobScheduler(BILLING_SCHEDULER_ID);
  }
  const worker = new Worker(
    REPORTS_QUEUE,
    async (job) => {
      if (job.name === "billing-reconcile") {
        if (!asaas) return;
        const send = createMailer();
        const result = await reconcileAll({
          client: deps.prisma,
          asaas,
          actor: { type: "SYSTEM" },
          // Cobrança para revisar achada na conferência: e-mail para os administradores confirmados.
          notify: (notice) => notifyAdminsOfReview(deps.prisma, send, notice).then(() => undefined),
        });
        if (result.orphans > 0) deps.logger.warn(result, "[cobrança] assinaturas órfãs canceladas no Asaas");
        if (result.failed > 0) deps.logger.warn(result, "[cobrança] conferência com falhas");
        return;
      }
      await syncShopeeConversions(deps);
    },
    { connection, concurrency: 1 },
  );
  worker.on("failed", (_job, err) => deps.logger.error({ err }, "[relatórios] job falhou"));
  return { queue, worker };
}
