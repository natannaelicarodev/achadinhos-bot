// Vitrine compartilhada: a extensão do ADMINISTRADOR busca a vitrine do portal de
// afiliados (mais vendidos, por categoria) e envia os produtos ao catálogo central.
// Só dados públicos de produto saem do navegador: nada da sessão do ML.
import type { AmazonBestseller } from "./amazon";
import type { HubItem } from "./protocol";

/** Páginas da vitrine por categoria (mais vendidos). */
export const VITRINE_PAGES_PER_CATEGORY = 10;
/** Pausa entre pedidos ao ML (não sobrecarregar o portal). */
export const VITRINE_PAUSE_MS = 1_500;
export const VITRINE_ENDPOINT_PATH = "/api/catalog/mercado-livre";
export const AMAZON_VITRINE_ENDPOINT_PATH = "/api/catalog/amazon";
/** Amazon: páginas de "Mais vendidos" por categoria (30 produtos cada) e pausa maior entre pedidos. */
export const AMAZON_PAGES_PER_CATEGORY = 2;
export const AMAZON_PAUSE_MS = 3_000;
export const VITRINE_INTERVAL_MINUTES = 60;
/** Categoria com menos que isso nos "mais vendidos" é completada com a vitrine normal (sem esse filtro). */
export const VITRINE_MIN_PER_CATEGORY = 60;

/** Páginas por palavra-chave (categorias que o portal não tem, ex.: Alimentos). */
export const VITRINE_PAGES_PER_SEARCH = 3;

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
 */
export async function collectVitrine(
  search: HubSearch,
  categories: string[],
  options: {
    searches?: string[];
    pages?: number;
    searchPages?: number;
    minPerCategory?: number;
    pause?: (ms: number) => Promise<void>;
  } = {},
): Promise<VitrineBatch[]> {
  const pages = options.pages ?? VITRINE_PAGES_PER_CATEGORY;
  const pause = options.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
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
        if (!first) await pause(VITRINE_PAUSE_MS);
        first = false;
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
 * Amazon: "Mais vendidos" de cada categoria, até N páginas. Captcha PARA tudo
 * (não insiste); outra falha numa categoria não derruba as outras.
 */
export async function collectAmazonVitrine(
  read: (slug: string, page: number) => Promise<AmazonBestseller[]>,
  slugs: string[],
  options: { pages?: number; pause?: (ms: number) => Promise<void> } = {},
): Promise<AmazonVitrineBatch[]> {
  const pages = options.pages ?? AMAZON_PAGES_PER_CATEGORY;
  const pause = options.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const batches: AmazonVitrineBatch[] = [];
  let firstError: unknown = null;
  let first = true;
  for (const slug of slugs) {
    const items: AmazonBestseller[] = [];
    try {
      for (let page = 1; page <= pages; page++) {
        if (!first) await pause(AMAZON_PAUSE_MS);
        first = false;
        const found = await read(slug, page);
        if (found.length === 0) break;
        items.push(...found);
      }
    } catch (error) {
      if (error instanceof Error && /captcha/i.test(error.message)) {
        if (batches.length === 0 && items.length === 0) throw error;
        if (items.length > 0) batches.push({ slug, items });
        return batches; // a Amazon desconfiou: para por aqui
      }
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
