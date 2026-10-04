// Contrato entre painel (web) e worker: fila BullMQ "whatsapp" e chaves Redis.
import { z } from "zod";

export const WHATSAPP_QUEUE = "whatsapp";

const base = { tenantId: z.string().min(1), channelId: z.string().min(1) };

export const whatsappJobSchemas = {
  /** Conecta (ou reconecta) o número. Sem sessão salva, gera QR Code. */
  connect: z.object(base),
  /** Remove o número: logout no WhatsApp, apaga sessão, libera trava, apaga o canal. */
  remove: z.object(base),
  /** Relê os grupos do número no WhatsApp. */
  syncGroups: z.object(base),
  /** Envio de teste para um grupo (com limite por número). */
  sendTest: z.object({
    ...base,
    groupId: z.string().min(1),
    text: z.string().trim().min(1).max(4096),
    imageUrl: z.string().trim().max(2048).optional(),
  }),
} as const;

export type WhatsappJobName = keyof typeof whatsappJobSchemas;
export type WhatsappJobData<N extends WhatsappJobName> = z.infer<(typeof whatsappJobSchemas)[N]>;

export function parseWhatsappJob<N extends WhatsappJobName>(name: N, data: unknown): WhatsappJobData<N> {
  return whatsappJobSchemas[name].parse(data) as WhatsappJobData<N>;
}

export function isWhatsappJobName(name: string): name is WhatsappJobName {
  return Object.hasOwn(whatsappJobSchemas, name);
}

/** Resultado de um job, devolvido ao painel. `message` sempre em pt-BR. */
export type WhatsappJobResult = { ok: true; message: string; warning?: string } | { ok: false; message: string };

export const redisKeys = {
  /** QR Code atual do número (expira sozinho). */
  qr: (channelId: string) => `wa:qr:${channelId}`,
  /** Trava: só um worker por número. */
  lock: (channelId: string) => `wa:lock:${channelId}`,
  /** Horários dos envios de teste do número (limite por hora). */
  testSends: (channelId: string) => `wa:test-sends:${channelId}`,
};

export const QR_TTL_SECONDS = 60;

/** Fila da mineração do catálogo central (só o worker usa). */
export const CATALOG_QUEUE = "catalog";
export const CATALOG_SCHEDULER_ID = "catalog-mining";
