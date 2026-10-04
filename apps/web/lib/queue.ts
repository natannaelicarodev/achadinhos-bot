// Painel -> worker: fila BullMQ "whatsapp" e leitura do QR Code no Redis.
import {
  redisKeys,
  WHATSAPP_QUEUE,
  whatsappJobSchemas,
  type WhatsappJobData,
  type WhatsappJobName,
  type WhatsappJobResult,
} from "@achadinhos/jobs";
import { Queue, QueueEvents } from "bullmq";
import { Redis } from "ioredis";

interface QueueGlobals {
  redis?: Redis;
  queue?: Queue;
  events?: QueueEvents;
}
const g = globalThis as unknown as { achadinhosQueue?: QueueGlobals };
const state = (g.achadinhosQueue ??= {});

function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL não definida no .env.");
  return url;
}

function connection(): Redis {
  return new Redis(redisUrl(), { maxRetriesPerRequest: null });
}

export function getRedis(): Redis {
  state.redis ??= connection();
  return state.redis;
}

function getQueue(): Queue {
  state.queue ??= new Queue(WHATSAPP_QUEUE, { connection: getRedis() });
  return state.queue;
}

function getEvents(): QueueEvents {
  state.events ??= new QueueEvents(WHATSAPP_QUEUE, { connection: connection() });
  return state.events;
}

const jobOptions = { removeOnComplete: { age: 3600 }, removeOnFail: { age: 24 * 3600 }, attempts: 1 };

/** Enfileira e segue (ex.: conectar; o painel acompanha pelo status). */
export async function enqueueWhatsappJob<N extends WhatsappJobName>(name: N, data: WhatsappJobData<N>) {
  const payload = whatsappJobSchemas[name].parse(data);
  await getQueue().add(name, payload, jobOptions);
}

/** Enfileira e espera o resultado do worker (ex.: enviar teste). */
export async function runWhatsappJob<N extends WhatsappJobName>(
  name: N,
  data: WhatsappJobData<N>,
  timeoutMs: number,
): Promise<WhatsappJobResult> {
  const payload = whatsappJobSchemas[name].parse(data);
  const events = getEvents();
  await events.waitUntilReady();
  const job = await getQueue().add(name, payload, jobOptions);
  try {
    return (await job.waitUntilFinished(events, timeoutMs)) as WhatsappJobResult;
  } catch {
    return {
      ok: false,
      message: "O worker não respondeu a tempo. Confira se ele está rodando; o comando será feito quando ele voltar.",
    };
  }
}

export async function getQrCode(channelId: string): Promise<string | null> {
  return getRedis().get(redisKeys.qr(channelId));
}
