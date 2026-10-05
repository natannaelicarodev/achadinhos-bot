// Vitrine compartilhada: a extensão do ADMINISTRADOR busca a vitrine do portal de
// afiliados (mais vendidos, por categoria) e envia os produtos ao catálogo central.
// Só dados públicos de produto saem do navegador: nada da sessão do ML.
//
// Cuidados para não parecer robô (aprovados em 10/2026):
// - pausa ALEATÓRIA entre pedidos: ML 3 a 6 s; Amazon 5 a 10 s;
// - no máximo 100 páginas/hora no ML e 30/hora na Amazon (janela móvel de 60 min);
// - captcha ou bloqueio em QUALQUER loja: para tudo e só volta 1 hora depois;
// - "Atualizar agora" só 15 min depois da última rodada.
import type { AmazonBestseller } from "./amazon";
import type { HubItem } from "./protocol";

/** Páginas da vitrine por categoria (mais vendidos). */
export const VITRINE_PAGES_PER_CATEGORY = 10;
export const VITRINE_ENDPOINT_PATH = "/api/catalog/mercado-livre";
export const AMAZON_VITRINE_ENDPOINT_PATH = "/api/catalog/amazon";
/** Amazon: páginas de "Mais vendidos" por categoria (30 produtos cada). */
export const AMAZON_PAGES_PER_CATEGORY = 2;
export const VITRINE_INTERVAL_MINUTES = 60;
/** Categoria com menos que isso nos "mais vendidos" é completada com a vitrine normal (sem esse filtro). */
export const VITRINE_MIN_PER_CATEGORY = 60;
/** Páginas por palavra-chave (categorias que o portal não tem, ex.: Alimentos). */
export const VITRINE_PAGES_PER_SEARCH = 3;

export type PauseRange = readonly [minMs: number, maxMs: number];
export const ML_PAUSE_RANGE_MS: PauseRange = [3_000, 6_000];
export const AMAZON_PAUSE_RANGE_MS: PauseRange = [5_000, 10_000];
export const ML_PAGES_PER_HOUR = 100;
export const AMAZON_PAGES_PER_HOUR = 30;
export const PAGE_WINDOW_MS = 60 * 60_000;
/** Captcha/bloqueio: tudo parado por 1 hora. */
export const BLOCK_COOLDOWN_MS = 60 * 60_000;
/** "Atualizar agora": só depois de 15 min da última rodada. */
export const RUN_NOW_MIN_INTERVAL_MS = 15 * 60_000;

/** Limite de páginas por hora da loja atingido: a rodada para (sem erro grave). */
export class HourlyLimitError extends Error {
  override name = "HourlyLimitError";
}

/** Captcha ou bloqueio da loja: para TUDO (todas as lojas) por 1 hora. */
export function isBlockError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as { status?: unknown }).status;
  return /captcha|bloque|blocked|too many/i.test(error.message) || status === 429 || status === 503;
}

/** Pausa aleatória dentro da faixa (nunca fixa). */
export function randomPauseMs(range: PauseRange, random: () => number = Math.random): number {
  return Math.round(range[0] + (range[1] - range[0]) * random());
}

/**
 * Janela móvel de 60 min: devolve o registro sem as páginas antigas e se ainda
 * cabe mais uma página. `log` = horários (ms) das páginas já pedidas.
 */
export function checkPageBudget(log: number[], now: number, limit: number): { ok: boolean; log: number[] } {
  const recent = log.filter((t) => now - t < PAGE_WINDOW_MS);
  return { ok: recent.length < limit, log: recent };
}

interface CollectOptions {
  /** Chamado antes de CADA pedido: conta a página e lança HourlyLimitError se passou do limite. */
  beforeRequest?: () => Promise<void>;
  pauseRange?: PauseRange;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface VitrineBatch {
  /** Categoria do ML pesquisada (null = sem categoria). */
  mlCategory: string | null;
  /** Palavra pesquisada (o painel decide a categoria do catálogo). Vazio = sem busca. */
  search: string;
  items: HubItem[];
}

type HubSearch = (params: { category: string | null; search: string; offset: number; bestSeller: boolean }) => Promise<HubItem[]>;

/**
 * Busca as categorias, depois as palavras-chave e por último a vitrine geral.
 * Falha numa busca não derruba as outras; se TODAS falharem, lança o primeiro erro.
 * Limite de páginas da hora: para e devolve o que já leu. Bloqueio: lança na hora.
 */
export async function collectVitrine(
  search: HubSearch,
  categories: string[],
  options: CollectOptions & { searches?: string[]; pages?: number; searchPages?: number; minPerCategory?: number } = {},
): Promise<VitrineBatch[]> {
  const pages = options.pages ?? VITRINE_PAGES_PER_CATEGORY;
  const sleep = options.sleep ?? defaultSleep;
  const queries = [
    ...categories.map((mlCategory) => ({ mlCategory, search: "", pages })),
    ...(options.searches ?? []).map((term) => ({ mlCategory: null, search: term, pages: options.searchPages ?? VITRINE_PAGES_PER_SEARCH })),
    { mlCategory: null, search: "", pages },
  ];
  const batches: VitrineBatch[] = [];
  let firstError: unknown = null;
  let first = true;
  for (const { mlCategory, search: term, pages: queryPages } of queries) {
    const items: HubItem[] = [];
    const seen = new Set<string>();
    const fetchPages = async (bestSeller: boolean, maxPages: number) => {
      let offset = 0;
      for (let page = 0; page < maxPages; page++) {
        if (!first) await sleep(randomPauseMs(options.pauseRange ?? ML_PAUSE_RANGE_MS, options.random));
        first = false;
        await options.beforeRequest?.();
        const found = await search({ category: mlCategory, search: term, offset, bestSeller });
        if (found.length === 0) break;
        for (const item of found) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          items.push(item);
        }
        offset += found.length;
      }
    };
    try {
      await fetchPages(true, queryPages);
      // Poucos "mais vendidos": completa com a vitrine normal da mesma busca.
      const min = term ? Math.min(options.minPerCategory ?? VITRINE_MIN_PER_CATEGORY, 20) : (options.minPerCategory ?? VITRINE_MIN_PER_CATEGORY);
      if (items.length < min) await fetchPages(false, queryPages);
    } catch (error) {
      if (error instanceof HourlyLimitError) {
        if (items.length > 0) batches.push({ mlCategory, search: term, items });
        if (batches.length === 0) throw error;
        return batches;
      }
      if (isBlockError(error)) throw error;
      firstError ??= error;
    }
    if (items.length > 0) batches.push({ mlCategory, search: term, items });
  }
  if (batches.length === 0 && firstError) throw firstError;
  return batches;
}

export interface AmazonVitrineBatch {
  /** Categoria dos "Mais vendidos" da Amazon (ex.: "grocery"). */
  slug: string;
  items: AmazonBestseller[];
}

/**
 * Amazon: "Mais vendidos" de cada categoria, até N páginas. Captcha/bloqueio lança na
 * hora (para tudo); limite da hora para e devolve o que já leu; outra falha numa
 * categoria não derruba as outras.
 */
export async function collectAmazonVitrine(
  read: (slug: string, page: number) => Promise<AmazonBestseller[]>,
  slugs: string[],
  options: CollectOptions & { pages?: number } = {},
): Promise<AmazonVitrineBatch[]> {
  const pages = options.pages ?? AMAZON_PAGES_PER_CATEGORY;
  const sleep = options.sleep ?? defaultSleep;
  const batches: AmazonVitrineBatch[] = [];
  let firstError: unknown = null;
  let first = true;
  for (const slug of slugs) {
    const items: AmazonBestseller[] = [];
    try {
      for (let page = 1; page <= pages; page++) {
        if (!first) await sleep(randomPauseMs(options.pauseRange ?? AMAZON_PAUSE_RANGE_MS, options.random));
        first = false;
        await options.beforeRequest?.();
        const found = await read(slug, page);
        if (found.length === 0) break;
        items.push(...found);
      }
    } catch (error) {
      if (error instanceof HourlyLimitError) {
        if (items.length > 0) batches.push({ slug, items });
        if (batches.length === 0) throw error;
        return batches;
      }
      if (isBlockError(error)) throw error;
      firstError ??= error;
    }
    if (items.length > 0) batches.push({ slug, items });
  }
  if (batches.length === 0 && firstError) throw firstError;
  return batches;
}

/** Envia ao painel. A chave da vitrine autentica o pedido (Bearer). */
export async function postVitrine(
  http: typeof fetch,
  endpoint: string,
  token: string,
  batches: VitrineBatch[] | AmazonVitrineBatch[],
  path: string = VITRINE_ENDPOINT_PATH,
): Promise<{ upserted: number }> {
  const response = await http(new URL(path, endpoint).toString(), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ batches }),
  });
  let body: { upserted?: unknown; error?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // resposta sem JSON
  }
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `O painel recusou os produtos (HTTP ${response.status}).`);
  }
  return { upserted: typeof body.upserted === "number" ? body.upserted : 0 };
}
