// Shopee: Open API de afiliados (GraphQL) com a credencial CENTRAL do sistema.
// Só leitura de produtos. O `offerLink` (link de afiliado da conta central)
// nem é pedido na consulta: o catálogo guarda só o link limpo (`productLink`).
import { createHash } from "node:crypto";
import type { CatalogCategory, MinedProduct } from "@achadinhos/db";
import { z } from "zod";
import type { CatalogMiner, MineResult, MinerStatus } from "./types";

export const SHOPEE_GRAPHQL_URL = "https://open-api.affiliate.shopee.com.br/graphql";

/** Assinatura exigida pela Shopee: SHA256(AppId + Timestamp + Payload + Secret), em hex. */
export function shopeeSignature(appId: string, timestamp: number, payload: string, secret: string): string {
  return createHash("sha256").update(`${appId}${timestamp}${payload}${secret}`).digest("hex");
}

export function shopeeAuthorization(appId: string, timestamp: number, signature: string): string {
  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`;
}

export class ShopeeApiError extends Error {
  override name = "ShopeeApiError";
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

export interface ShopeeClientOptions {
  appId: string;
  secret: string;
  fetch?: typeof fetch;
  /** Segundos Unix (substituível nos testes). */
  now?: () => number;
  timeoutMs?: number;
}

export class ShopeeAffiliateClient {
  constructor(private readonly options: ShopeeClientOptions) {}

  async query(query: string): Promise<unknown> {
    const { appId, secret } = this.options;
    const payload = JSON.stringify({ query });
    const timestamp = this.options.now?.() ?? Math.floor(Date.now() / 1000);
    const signature = shopeeSignature(appId, timestamp, payload, secret);
    const response = await (this.options.fetch ?? fetch)(SHOPEE_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: shopeeAuthorization(appId, timestamp, signature),
      },
      body: payload,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
    });
    if (!response.ok) throw new ShopeeApiError(`Shopee respondeu HTTP ${response.status}.`);
    const body = (await response.json()) as { data?: unknown; errors?: { message?: string; extensions?: { code?: number } }[] };
    const error = body.errors?.[0];
    if (error) throw new ShopeeApiError(error.message ?? "Erro da API da Shopee.", error.extensions?.code);
    return body.data;
  }
}

// ---------- Consulta productOfferV2 ----------

const NODE_FIELDS =
  "itemId productName imageUrl priceMin priceMax priceDiscountRate commissionRate commission sales ratingStar productLink productCatIds";

export interface ProductOfferArgs {
  keyword?: string;
  itemId?: string;
  /** 1 relevância, 2 vendas, 5 comissão (maior primeiro). */
  sortType?: 1 | 2 | 5;
  /** 2 = "top performing". */
  listType?: 2;
  page: number;
  limit: number;
}

export function productOfferQuery(args: ProductOfferArgs): string {
  const parts: string[] = [];
  if (args.keyword) parts.push(`keyword: ${JSON.stringify(args.keyword)}`);
  if (args.itemId) {
    if (!/^\d+$/.test(args.itemId)) throw new Error(`itemId inválido: ${args.itemId}`);
    parts.push(`itemId: ${args.itemId}`);
  }
  if (args.sortType) parts.push(`sortType: ${args.sortType}`);
  if (args.listType) parts.push(`listType: ${args.listType}`);
  parts.push(`page: ${args.page}`, `limit: ${args.limit}`);
  return `{ productOfferV2(${parts.join(", ")}) { nodes { ${NODE_FIELDS} } pageInfo { page limit hasNextPage } } }`;
}

// A API devolve vários números como texto ("29.9", "0.08", "4.8").
const numeric = z.union([z.number(), z.string()]).transform((v) => (v === "" ? Number.NaN : Number(v)));
const optionalNumeric = numeric.nullish();

const nodeSchema = z.object({
  itemId: z.union([z.number(), z.string()]).transform(String),
  productName: z.string().min(1),
  imageUrl: z.string().nullish(),
  priceMin: optionalNumeric,
  priceMax: optionalNumeric,
  priceDiscountRate: optionalNumeric,
  commissionRate: optionalNumeric,
  commission: optionalNumeric,
  sales: optionalNumeric,
  ratingStar: optionalNumeric,
  productLink: z.string().url(),
});

const responseSchema = z.object({
  productOfferV2: z.object({
    nodes: z.array(z.unknown()),
    pageInfo: z.object({ hasNextPage: z.boolean().nullish() }).nullish(),
  }),
});

const finite = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
const toCents = (reais: number) => Math.round(reais * 100);

/** Converte um item da Shopee para o formato do catálogo. null se faltar dado essencial. */
export function toMinedProduct(raw: unknown, category: CatalogCategory): MinedProduct | null {
  const parsed = nodeSchema.safeParse(raw);
  if (!parsed.success) return null;
  const n = parsed.data;
  const price = finite(n.priceMin) && n.priceMin > 0 ? n.priceMin : finite(n.priceMax) && n.priceMax > 0 ? n.priceMax : null;
  if (price === null) return null;

  const priceCents = toCents(price);
  const discountPct = finite(n.priceDiscountRate) && n.priceDiscountRate > 0 && n.priceDiscountRate < 100
    ? Math.round(n.priceDiscountRate)
    : null;
  const originalPriceCents = discountPct ? Math.round(priceCents / (1 - discountPct / 100)) : null;
  // commissionRate vem como fração ("0.08" = 8%); por garantia aceita também "8".
  const commissionPct = finite(n.commissionRate) && n.commissionRate > 0
    ? Math.round((n.commissionRate <= 1 ? n.commissionRate * 100 : n.commissionRate) * 100) / 100
    : null;
  const commissionCents = finite(n.commission) && n.commission > 0
    ? toCents(n.commission)
    : commissionPct !== null
      ? Math.round((priceCents * commissionPct) / 100)
      : null;

  return {
    store: "SHOPEE",
    externalId: n.itemId,
    title: n.productName.trim(),
    imageUrl: n.imageUrl || null,
    productUrl: n.productLink,
    category,
    priceCents,
    originalPriceCents,
    discountPct,
    commissionPct,
    commissionCents,
    rating: finite(n.ratingStar) && n.ratingStar > 0 ? Math.round(n.ratingStar * 10) / 10 : null,
    soldCount: finite(n.sales) && n.sales >= 0 ? Math.round(n.sales) : null,
  };
}

export function parseProductOffers(data: unknown, category: CatalogCategory): MinedProduct[] {
  const parsed = responseSchema.safeParse(data);
  if (!parsed.success) throw new ShopeeApiError("Resposta inesperada da Shopee (productOfferV2).");
  return parsed.data.productOfferV2.nodes
    .map((node) => toMinedProduct(node, category))
    .filter((p): p is MinedProduct => p !== null);
}

// ---------- Minerador ----------

/** Palavras-chave por categoria (trocar por productCatId quando conhecermos os ids do Brasil). */
export const SHOPEE_CATEGORY_KEYWORDS: Record<Exclude<CatalogCategory, "OTHER">, string[]> = {
  FOOD_BEVERAGES: ["café", "chocolate", "azeite"],
  BEAUTY: ["maquiagem", "perfume", "skincare"],
  HOME_KITCHEN_DECOR: ["organizador cozinha", "jogo de panelas", "decoração casa"],
  ELECTRONICS: ["fone bluetooth", "carregador turbo", "smartwatch"],
  KIDS_BABY: ["brinquedo infantil", "roupa bebê", "mochila infantil"],
  FASHION: ["camiseta", "tênis", "bolsa feminina"],
  PETS: ["ração", "brinquedo pet", "cama pet"],
  HEALTH: ["whey protein", "vitamina", "massageador"],
};

export interface ShopeeMinerOptions {
  appId?: string | undefined;
  secret?: string | undefined;
  fetch?: typeof fetch;
  /** Pausa entre chamadas (respeitar a cota da API). */
  delayMs?: number;
  pageLimit?: number;
  topPerformingPages?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ShopeeMiner implements CatalogMiner {
  readonly store = "SHOPEE" as const;
  private readonly client: ShopeeAffiliateClient | null;

  constructor(private readonly options: ShopeeMinerOptions) {
    this.client =
      options.appId && options.secret
        ? new ShopeeAffiliateClient({ appId: options.appId, secret: options.secret, ...(options.fetch ? { fetch: options.fetch } : {}) })
        : null;
  }

  status(): MinerStatus {
    return this.client
      ? { enabled: true }
      : { enabled: false, reason: "Credencial central da Shopee não configurada (SHOPEE_CATALOG_APP_ID e SHOPEE_CATALOG_SECRET)." };
  }

  private async fetchOffers(args: ProductOfferArgs, category: CatalogCategory) {
    if (!this.client) throw new Error("Minerador da Shopee desligado.");
    return parseProductOffers(await this.client.query(productOfferQuery(args)), category);
  }

  async mine(): Promise<MineResult> {
    const limit = this.options.pageLimit ?? 50;
    const sleep = this.options.sleep ?? defaultSleep;
    const searches: { args: ProductOfferArgs; category: CatalogCategory }[] = [];
    for (const [category, keywords] of Object.entries(SHOPEE_CATEGORY_KEYWORDS) as [CatalogCategory, string[]][]) {
      for (const keyword of keywords) {
        searches.push({ args: { keyword, sortType: 2, page: 1, limit }, category }); // mais vendidos
        searches.push({ args: { keyword, sortType: 5, page: 1, limit }, category }); // maior comissão
      }
    }
    for (let page = 1; page <= (this.options.topPerformingPages ?? 2); page++) {
      searches.push({ args: { listType: 2, sortType: 2, page, limit }, category: "OTHER" });
    }

    const products: MinedProduct[] = [];
    let failures = 0;
    let firstError: unknown;
    for (const [index, search] of searches.entries()) {
      if (index > 0) await sleep(this.options.delayMs ?? 500);
      try {
        products.push(...(await this.fetchOffers(search.args, search.category)));
      } catch (error) {
        failures += 1;
        firstError ??= error;
      }
    }
    // Tudo falhou (ex.: assinatura inválida): a execução falha com o motivo.
    if (failures === searches.length) throw firstError;
    return { products, requests: searches.length, failures };
  }

  async verify(externalIds: string[]): Promise<Map<string, MinedProduct | null>> {
    const sleep = this.options.sleep ?? defaultSleep;
    const result = new Map<string, MinedProduct | null>();
    for (const [index, itemId] of externalIds.entries()) {
      if (index > 0) await sleep(this.options.delayMs ?? 500);
      try {
        const [found] = await this.fetchOffers({ itemId, page: 1, limit: 1 }, "OTHER");
        result.set(itemId, found && found.externalId === itemId ? found : null);
      } catch {
        // Erro de rede/cota: não desativa (só desativa quando a loja responde sem o produto).
      }
    }
    return result;
  }
}
