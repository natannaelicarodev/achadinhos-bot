// Trava por número no Redis: só um worker abre cada número (evita o
// "connectionReplaced" de dois processos derrubando um ao outro).
import { redisKeys } from "@achadinhos/jobs";
import type { Redis } from "ioredis";

export const LOCK_TTL_MS = 60_000;

// Renova/libera só se a trava ainda for deste worker.
const RENEW_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export class ChannelLocks {
  constructor(
    private readonly redis: Redis,
    /** Identificador único deste processo. */
    readonly owner: string,
    private readonly ttlMs: number = LOCK_TTL_MS,
  ) {}

  /** true se a trava ficou (ou já estava) com este worker. */
  async acquire(channelId: string): Promise<boolean> {
    const key = redisKeys.lock(channelId);
    const set = await this.redis.set(key, this.owner, "PX", this.ttlMs, "NX");
    return set === "OK" || (await this.renew(channelId));
  }

  async renew(channelId: string): Promise<boolean> {
    const result = await this.redis.eval(RENEW_SCRIPT, 1, redisKeys.lock(channelId), this.owner, this.ttlMs);
    return result === 1;
  }

  async release(channelId: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, redisKeys.lock(channelId), this.owner);
  }
}
