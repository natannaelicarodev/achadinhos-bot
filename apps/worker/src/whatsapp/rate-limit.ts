// Limite dos envios de teste: 10 por número por hora, 20s entre envios.
import { redisKeys } from "@achadinhos/jobs";
import type { Redis } from "ioredis";

export const TEST_SEND_LIMITS = { perHour: 10, minIntervalMs: 20_000, windowMs: 60 * 60_000 } as const;

export type RateCheck = { ok: true } | { ok: false; message: string };

/** `history`: horários (ms) dos envios anteriores, em qualquer ordem. */
export function checkTestSend(history: number[], now: number): RateCheck {
  const recent = history.filter((t) => now - t < TEST_SEND_LIMITS.windowMs).sort((a, b) => b - a);
  const last = recent[0];
  if (last !== undefined && now - last < TEST_SEND_LIMITS.minIntervalMs) {
    const seconds = Math.ceil((TEST_SEND_LIMITS.minIntervalMs - (now - last)) / 1000);
    return { ok: false, message: `Aguarde ${seconds}s para enviar outro teste por este número.` };
  }
  if (recent.length >= TEST_SEND_LIMITS.perHour) {
    const oldest = recent[TEST_SEND_LIMITS.perHour - 1] ?? now;
    const minutes = Math.max(1, Math.ceil((TEST_SEND_LIMITS.windowMs - (now - oldest)) / 60_000));
    return {
      ok: false,
      message: `Limite de ${TEST_SEND_LIMITS.perHour} envios de teste por hora para este número. Tente de novo em ${minutes} min.`,
    };
  }
  return { ok: true };
}

export interface TestSendHistory {
  list(channelId: string): Promise<number[]>;
  record(channelId: string, at: number): Promise<void>;
}

/** Histórico no Redis (sobrevive a reinício do worker). */
export function redisTestSendHistory(redis: Redis): TestSendHistory {
  return {
    async list(channelId) {
      const values = await redis.lrange(redisKeys.testSends(channelId), 0, -1);
      return values.map(Number).filter(Number.isFinite);
    },
    async record(channelId, at) {
      const key = redisKeys.testSends(channelId);
      await redis
        .multi()
        .lpush(key, String(at))
        .ltrim(key, 0, TEST_SEND_LIMITS.perHour - 1)
        .pexpire(key, TEST_SEND_LIMITS.windowMs)
        .exec();
    },
  };
}

export function memoryTestSendHistory(): TestSendHistory {
  const store = new Map<string, number[]>();
  return {
    async list(channelId) {
      return [...(store.get(channelId) ?? [])];
    },
    async record(channelId, at) {
      store.set(channelId, [at, ...(store.get(channelId) ?? [])].slice(0, TEST_SEND_LIMITS.perHour));
    },
  };
}

/** Uma checagem+envio por número de cada vez (sem corrida entre dois cliques). */
export class PerKeyMutex {
  private tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.tails.set(key, next);
    void next.finally(() => {
      if (this.tails.get(key) === next) this.tails.delete(key);
    }).catch(() => undefined);
    return next;
  }
}
