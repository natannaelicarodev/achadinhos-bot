// Piloto automático + fila de envio (BullMQ job scheduler): um tick a cada 15 s.
// O piloto escolhe ofertas no máximo 1x por minuto; o envio roda em todo tick.
import { AUTOPILOT_QUEUE, AUTOPILOT_SCHEDULER_ID } from "@achadinhos/jobs";
import { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import { runAutopilotTick, type AutopilotDeps } from "../autopilot/engine";

export const TICK_EVERY_MS = 15_000;
export const FAST_TICK_EVERY_MS = 5_000;

export async function startAutopilot(connection: Redis, deps: AutopilotDeps) {
  const every = deps.fast ? FAST_TICK_EVERY_MS : TICK_EVERY_MS;
  const queue = new Queue(AUTOPILOT_QUEUE, { connection });
  await queue.upsertJobScheduler(
    AUTOPILOT_SCHEDULER_ID,
    { every },
    { name: "tick", opts: { removeOnComplete: true, removeOnFail: { count: 20 } } },
  );

  let lastPickMinute = -1;
  // Um tick por vez (concurrency 1): nunca dois envios do mesmo número ao mesmo tempo.
  const worker = new Worker(
    AUTOPILOT_QUEUE,
    async () => {
      const now = new Date();
      const minute = Math.floor(now.getTime() / 60_000);
      const withPicks = minute !== lastPickMinute;
      if (withPicks) lastPickMinute = minute;
      const result = await runAutopilotTick(deps, now, { withPicks });
      const sent = result.dispatched.filter((d) => "sent" in d).length;
      if (sent > 0 || result.discarded > 0 || result.manual > 0) {
        deps.logger?.info({ sent, discarded: result.discarded, manual: result.manual }, "[piloto] tick");
      }
    },
    { connection, concurrency: 1 },
  );
  worker.on("failed", (_job, err) => deps.logger?.error({ err }, "[piloto] tick falhou"));
  deps.logger?.info({ everyMs: every, fast: Boolean(deps.fast) }, "[piloto] fila de envio iniciada");
  return { queue, worker };
}
