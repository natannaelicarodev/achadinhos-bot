// Piloto automático: regras puras (sem banco), usadas pelo worker e pelo painel.
// Horários sempre no fuso America/Sao_Paulo; "hoje" = dia em São Paulo.
// Sem Prisma em tempo de execução: o painel importa este arquivo no navegador
// (@achadinhos/db/autopilot). Só tipos do client gerado.
import type { Store } from "./generated/prisma/client";

export type { Store };

export const AUTOPILOT_TIMEZONE = "America/Sao_Paulo";

/** Post do piloto que não saiu em até 60 min depois de agendado é DESCARTADO. */
export const AUTO_POST_MAX_DELAY_MS = 60 * 60_000;
/** Post manual ("Enviar para meus grupos") espera a janela abrir por até 24h. */
export const MANUAL_POST_MAX_DELAY_MS = 24 * 60 * 60_000;
/** Tentativas por post e espera antes de cada nova tentativa (1, 5 e 15 min). */
export const POST_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;
export const POST_MAX_ATTEMPTS = POST_RETRY_DELAYS_MS.length;
/** Posts seguidos com falha no mesmo número até pausar o piloto daquele número. */
export const CHANNEL_MAX_CONSECUTIVE_FAILURES = 3;
/** Aquecimento: número novo começa com 20 mensagens/dia e chega ao limite no 7º dia. */
export const WARMUP_DAYS = 7;
export const WARMUP_FIRST_DAY_LIMIT = 20;
/** Folga por oferta na conta "cabe na hora" (montar link, imagem, imprevistos). */
export const OFFER_SLACK_SECONDS = 5 * 60;
export const MAX_OFFERS_PER_HOUR = 12;

/**
 * Lojas cujo link de afiliado sai no SERVIDOR (sem o navegador do cliente).
 * Mercado Livre só com ML_AUTOPILOT_ENABLED=true (link longo matt_word/matt_tool);
 * meli.la (extensão) nunca entra no piloto.
 */
export function autopilotStores(env: Record<string, string | undefined> = process.env): Store[] {
  return env.ML_AUTOPILOT_ENABLED === "true" ? ["SHOPEE", "AMAZON", "MERCADO_LIVRE"] : ["SHOPEE", "AMAZON"];
}

/** Idade máxima do preço (lastSeenAt) para o piloto escolher o produto. */
export function maxPriceAgeHours(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.AUTOPILOT_MAX_PRICE_AGE_HOURS);
  return Number.isFinite(value) && value > 0 ? value : 6;
}

// ---------- Fuso de São Paulo ----------

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: AUTOPILOT_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface LocalTime {
  /** 0 = domingo */
  weekday: number;
  /** minutos desde 00:00 em São Paulo */
  minuteOfDay: number;
  /** "2026-10-05" (dia em São Paulo) */
  dayKey: string;
}

export function localTime(now: Date): LocalTime {
  const p = Object.fromEntries(parts.formatToParts(now).map((x) => [x.type, x.value]));
  return {
    weekday: WEEKDAYS.indexOf(p.weekday ?? "Sun"),
    minuteOfDay: Number(p.hour) * 60 + Number(p.minute),
    dayKey: `${p.year}-${p.month}-${p.day}`,
  };
}

/** Instante (UTC) de um horário local de São Paulo no mesmo dia de `now`. */
export function atLocalMinute(now: Date, minuteOfDay: number): Date {
  const local = localTime(now);
  const seconds = Number(Object.fromEntries(parts.formatToParts(now).map((x) => [x.type, x.value])).second);
  const startOfMinute = now.getTime() - (now.getTime() % 1000) - seconds * 1000;
  return new Date(startOfMinute + (minuteOfDay - local.minuteOfDay) * 60_000);
}

/** 00:00 de hoje em São Paulo (início do "dia" dos limites). */
export const startOfLocalDay = (now: Date) => atLocalMinute(now, 0);

// ---------- Janela ----------

export interface WindowSettings {
  weekdays: number[];
  windowStartMinute: number;
  windowEndMinute: number;
}

export function isWithinWindow(settings: WindowSettings, now: Date): boolean {
  const local = localTime(now);
  return (
    settings.weekdays.includes(local.weekday) &&
    local.minuteOfDay >= settings.windowStartMinute &&
    local.minuteOfDay < settings.windowEndMinute
  );
}

/** Fim da janela de hoje (os posts do piloto não passam disso). */
export const windowEndToday = (settings: WindowSettings, now: Date) => atLocalMinute(now, settings.windowEndMinute);

export function formatMinute(minuteOfDay: number): string {
  return `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;
}

// ---------- Ritmo e limites ----------

/** Já passou o intervalo entre ofertas (60 / ofertas por hora)? */
export function pickIsDue(settings: { offersPerHour: number; lastPickAt: Date | null }, now: Date, minIntervalMs?: number): boolean {
  if (!settings.lastPickAt) return true;
  const interval = minIntervalMs ?? 3_600_000 / Math.max(1, settings.offersPerHour);
  return now.getTime() - settings.lastPickAt.getTime() >= interval;
}

/**
 * Máximo de ofertas por hora que cabe: os números enviam em paralelo, então vale o
 * número com MAIS grupos. Tempo de uma oferta = grupos x intervalo máximo + folga.
 * Ex.: 10 grupos x 90 s + 5 min = 20 min -> 3 ofertas por hora.
 */
export function maxOffersPerHour(maxGroupsPerChannel: number, groupIntervalMaxSeconds: number): number {
  if (maxGroupsPerChannel <= 0) return MAX_OFFERS_PER_HOUR;
  const perOffer = maxGroupsPerChannel * groupIntervalMaxSeconds + OFFER_SLACK_SECONDS;
  return Math.max(1, Math.min(MAX_OFFERS_PER_HOUR, Math.floor(3600 / perOffer)));
}

/** Dia de aquecimento (1 = primeiro dia) ou null se já aqueceu. */
export function warmupDay(connectedSince: Date | null, now: Date): number | null {
  if (!connectedSince) return 1;
  const startDay = startOfLocalDay(connectedSince).getTime();
  const today = startOfLocalDay(now).getTime();
  const day = Math.round((today - startDay) / 86_400_000) + 1;
  return day >= WARMUP_DAYS ? null : Math.max(1, day);
}

/** Limite diário de MENSAGENS do número (aquecimento: 20 no dia 1, subindo até o limite no dia 7). */
export function channelDailyLimitFor(connectedSince: Date | null, configuredLimit: number, now: Date): number {
  const day = warmupDay(connectedSince, now);
  if (day === null) return configuredLimit;
  const first = Math.min(WARMUP_FIRST_DAY_LIMIT, configuredLimit);
  return Math.round(first + ((configuredLimit - first) * (day - 1)) / (WARMUP_DAYS - 1));
}

/** Espera aleatória entre os grupos da mesma oferta (inclusive entre grupos do mesmo número). */
export function randomGroupIntervalMs(
  settings: { groupIntervalMinSeconds: number; groupIntervalMaxSeconds: number },
  random: () => number = Math.random,
): number {
  const min = Math.min(settings.groupIntervalMinSeconds, settings.groupIntervalMaxSeconds);
  const max = Math.max(settings.groupIntervalMinSeconds, settings.groupIntervalMaxSeconds);
  return Math.round((min + (max - min) * random()) * 1000);
}

/** Configuração padrão (cliente que nunca abriu a página Agendamento). */
export const DEFAULT_AUTOPILOT = {
  enabled: false,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  windowStartMinute: 480,
  windowEndMinute: 1320,
  offersPerHour: 2,
  stores: [] as Store[],
  categories: [],
  minDiscountPct: null,
  minPriceCents: null,
  maxPriceCents: null,
  minRating: null,
  minCommissionPct: null,
  groupIds: [] as string[],
  repeatDays: 3,
  groupIntervalMinSeconds: 30,
  groupIntervalMaxSeconds: 90,
  channelDailyLimit: 80,
  lastPickAt: null,
};
