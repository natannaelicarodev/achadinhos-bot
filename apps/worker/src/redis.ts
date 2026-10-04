import { Redis } from "ioredis";

/** maxRetriesPerRequest: null é exigido pelo BullMQ em conexões de worker. */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}
