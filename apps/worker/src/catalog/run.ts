// Uma execução da mineração: para cada loja, minera, grava, reconfere os
// produtos parados e registra tudo em CatalogMiningRun.
import {
  deactivateCatalogProducts,
  findStaleCatalogProducts,
  saveMinedProducts,
  type MinedProduct,
  type PrismaClient,
} from "@achadinhos/db";
import { withHeadlineKeys } from "@achadinhos/stores";
import type { Logger } from "pino";
import type { CatalogMiner } from "./types";

export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const VERIFY_LIMIT_PER_RUN = 50;

export interface RunDeps {
  prisma: PrismaClient;
  miners: CatalogMiner[];
  logger: Logger;
  now?: () => Date;
}

export async function runCatalogMining(deps: RunDeps) {
  const now = deps.now ?? (() => new Date());
  const summary = [];

  for (const miner of deps.miners) {
    const status = miner.status();
    if (!status.enabled) {
      deps.logger.info({ store: miner.store, reason: status.reason }, "[catálogo] minerador desligado");
      summary.push(
        await deps.prisma.catalogMiningRun.create({
          data: { store: miner.store, status: "SKIPPED", message: status.reason, finishedAt: now() },
        }),
      );
      continue;
    }

    const run = await deps.prisma.catalogMiningRun.create({ data: { store: miner.store, status: "RUNNING" } });
    try {
      const mined = await miner.mine();
      const saved = await saveMinedProducts(deps.prisma, withHeadlineKeys(mined.products), now());

      // Reconfere quem não apareceu nas listas há mais de 24h.
      const stale = await findStaleCatalogProducts(
        deps.prisma,
        miner.store,
        new Date(now().getTime() - STALE_AFTER_MS),
        VERIFY_LIMIT_PER_RUN,
      );
      const checked = await miner.verify(stale.map((s) => s.externalId));
      const stillThere = [...checked.values()].filter((p): p is MinedProduct => p !== null);
      const gone = [...checked.entries()].filter(([, p]) => p === null).map(([id]) => id);
      const refreshed = await saveMinedProducts(deps.prisma, withHeadlineKeys(stillThere), now());
      const removed = await deactivateCatalogProducts(deps.prisma, miner.store, gone);

      const message =
        mined.failures > 0 ? `${mined.failures} de ${mined.requests} buscas falharam; as demais foram gravadas.` : null;
      summary.push(
        await deps.prisma.catalogMiningRun.update({
          where: { id: run.id },
          data: {
            status: "SUCCESS",
            fetched: mined.products.length,
            upserted: saved.upserted + refreshed.upserted,
            deactivated: saved.deactivated + refreshed.deactivated + removed,
            message,
            finishedAt: now(),
          },
        }),
      );
      deps.logger.info({ store: miner.store, fetched: mined.products.length, ...saved, removed }, "[catálogo] mineração concluída");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido.";
      deps.logger.error({ store: miner.store, err: error }, "[catálogo] mineração falhou");
      summary.push(
        await deps.prisma.catalogMiningRun.update({
          where: { id: run.id },
          data: { status: "FAILED", message: message.slice(0, 500), finishedAt: now() },
        }),
      );
    }
  }
  return summary;
}
