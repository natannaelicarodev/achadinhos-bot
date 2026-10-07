// Consumidor da fila "whatsapp": comandos vindos do painel.
import { forTenant, getSendingBlock, PlanLimitError, type PrismaClient } from "@achadinhos/db";
import {
  isWhatsappJobName,
  parseWhatsappJob,
  WHATSAPP_QUEUE,
  type WhatsappJobResult,
} from "@achadinhos/jobs";
import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { ZodError } from "zod";
import type { WhatsAppManager } from "../whatsapp/manager";
import { checkTestSend, PerKeyMutex, type TestSendHistory } from "../whatsapp/rate-limit";
import { SendError } from "../whatsapp/send";

export interface WhatsappJobDeps {
  prisma: PrismaClient;
  manager: Pick<WhatsAppManager, "connect" | "remove" | "syncGroups" | "sendOfferToWhatsApp">;
  history: TestSendHistory;
  logger: Logger;
  now?: () => number;
}

const testMutex = new PerKeyMutex();

/** Processa um job e devolve o resultado para o painel (nunca lança erro esperado). */
export async function handleWhatsappJob(deps: WhatsappJobDeps, name: string, data: unknown): Promise<WhatsappJobResult> {
  try {
    if (!isWhatsappJobName(name)) return { ok: false, message: "Comando desconhecido." };

    // Todo job confere se o número é mesmo do tenant informado.
    const { tenantId, channelId } = parseWhatsappJob(name, data);
    const channel = await forTenant(tenantId, deps.prisma).channel.findUnique({ where: { id: channelId } });
    if (!channel || channel.type !== "WHATSAPP") return { ok: false, message: "Número não encontrado." };

    switch (name) {
      case "connect":
        await deps.manager.connect(tenantId, channelId);
        return { ok: true, message: "Conectando. Aguarde o QR Code ou a confirmação." };

      case "remove": {
        const { loggedOut } = await deps.manager.remove(tenantId, channelId);
        return {
          ok: true,
          message: loggedOut
            ? "Número removido e desconectado do WhatsApp."
            : "Número removido. Se ele ainda aparecer em Dispositivos conectados no celular, desconecte por lá.",
        };
      }

      case "syncGroups": {
        const { total, removed } = await deps.manager.syncGroups(tenantId, channelId);
        const extra = removed > 0 ? ` ${removed} grupo(s) saíram da lista.` : "";
        return { ok: true, message: `${total} grupo(s) atualizados.${extra}` };
      }

      case "sendTest": {
        const job = parseWhatsappJob("sendTest", data);
        return await testMutex.run(channelId, async () => {
          const now = (deps.now ?? Date.now)();
          // Pagamento pendente / sem assinatura: envios pausados (inclusive o teste).
          const block = await getSendingBlock(tenantId, { client: deps.prisma, now: new Date(now) });
          if (block) return { ok: false, message: block.message };
          const check = checkTestSend(await deps.history.list(channelId), now);
          if (!check.ok) return { ok: false, message: check.message };
          // O grupo precisa ser deste número.
          const group = await forTenant(tenantId, deps.prisma).group.findUnique({ where: { id: job.groupId } });
          if (!group || group.channelId !== channelId) return { ok: false, message: "Grupo não encontrado." };

          await deps.history.record(channelId, now);
          const result = await deps.manager.sendOfferToWhatsApp(tenantId, job.groupId, job.imageUrl ?? null, job.text);
          return {
            ok: true,
            message: result.imageSent ? "Teste enviado com imagem." : "Teste enviado.",
            ...(result.warning ? { warning: result.warning } : {}),
          };
        });
      }
    }
  } catch (error) {
    if (error instanceof SendError || error instanceof PlanLimitError) return { ok: false, message: error.message };
    if (error instanceof ZodError) return { ok: false, message: "Dados do comando inválidos." };
    deps.logger.error({ err: error, job: name }, "[whatsapp] erro inesperado no job");
    return { ok: false, message: "Erro inesperado no worker. Tente de novo." };
  }
}

export function startWhatsappQueueWorker(connection: Redis, deps: WhatsappJobDeps): Worker {
  const worker = new Worker(
    WHATSAPP_QUEUE,
    (job: Job) => handleWhatsappJob(deps, job.name, job.data),
    { connection, concurrency: 4 },
  );
  worker.on("failed", (job, err) => deps.logger.error({ job: job?.name, err }, "[whatsapp] job falhou"));
  return worker;
}
