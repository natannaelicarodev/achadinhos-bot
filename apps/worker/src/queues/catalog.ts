// Mineração recorrente do catálogo central (BullMQ job scheduler).
import type { PrismaClient } from "@achadinhos/db";
import { CATALOG_QUEUE, CATALOG_SCHEDULER_ID } from "@achadinhos/jobs";
import { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { runCatalogMining } from "../catalog/run";
import type { CatalogMiner } from "../catalog/types";

export interface CatalogQueueDeps {
  prisma: PrismaClient;
  miners: CatalogMiner[];
  logger: Logger;
  intervalMinutes: number;
}

/** Folga para o agendador não pular uma rodada por segundos de diferença. */
const DUE_TOLERANCE = 0.9;

/**
 * true se já passou o intervalo desde a última mineração que de fato rodou.
 * Execuções SKIPPED (minerador sem credencial) não contam: ao configurar a
 * credencial e reiniciar o worker, a mineração roda na hora.
 */
export async function miningIsDue(prisma: PrismaClient, intervalMinutes: number, now: Date = new Date()) {
  const last = await prisma.catalogMiningRun.findFirst({
    where: { status: { not: "SKIPPED" } },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });
  return !last || now.getTime() - last.startedAt.getTime() >= intervalMinutes * 60_000 * DUE_TOLERANCE;
}

/** Processa um job: minera só se estiver vencido (evita rodar duas vezes seguidas). */
export async function processCatalogJob(deps: CatalogQueueDeps): Promise<"ran" | "not-due"> {
  if (!(await miningIsDue(deps.prisma, deps.intervalMinutes))) return "not-due";
  await runCatalogMining(deps);
  return "ran";
}

/** Execuções que ficaram RUNNING porque o worker caiu/reiniciou no meio. */
export async function closeInterruptedRuns(prisma: PrismaClient, now: Date = new Date()) {
  const { count } = await prisma.catalogMiningRun.updateMany({
    where: { status: "RUNNING" },
    data: { status: "FAILED", message: "Execução interrompida (o worker reiniciou no meio).", finishedAt: now },
  });
  return count;
}

export async function startCatalogMining(connection: Redis, deps: CatalogQueueDeps) {
  // Um worker só por ambiente: ao subir, nenhuma mineração está de fato rodando.
  const interrupted = await closeInterruptedRuns(deps.prisma);
  if (interrupted > 0) deps.logger.info({ interrupted }, "[catálogo] execuções interrompidas marcadas como falha");

  const queue = new Queue(CATALOG_QUEUE, { connection });
  await queue.upsertJobScheduler(
    CATALOG_SCHEDULER_ID,
    { every: deps.intervalMinutes * 60_000 },
    { name: "mine", opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } } },
  );
  // Ao subir: roda já se estiver vencida (o job confere de novo antes de minerar).
  if (await miningIsDue(deps.prisma, deps.intervalMinutes)) {
    await queue.add("mine", {}, { jobId: `startup-${Math.floor(Date.now() / 60_000)}`, removeOnComplete: true });
  }

  // Uma execução por vez.
  const worker = new Worker(CATALOG_QUEUE, () => processCatalogJob(deps), { connection, concurrency: 1 });
  worker.on("failed", (_job, err) => deps.logger.error({ err }, "[catálogo] job falhou"));
  deps.logger.info({ everyMinutes: deps.intervalMinutes }, "[catálogo] mineração agendada");
  return { queue, worker };
}
