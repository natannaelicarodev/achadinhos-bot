// Leitura de produtos da Shopee (productOfferV2) com a credencial CENTRAL do sistema.
// Só LÊ: este tipo não tem como gerar link de afiliado. O `offerLink` (link de
// afiliado da conta central) nem é pedido na consulta.
import type { CatalogCategory, MinedProduct } from "@achadinhos/db";
import { z } from "zod";
import { ShopeeApiError, ShopeeGraphqlClient, type ShopeeClientOptions } from "./client";

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
  const price =
    finite(n.priceMin) && n.priceMin > 0 ? n.priceMin : finite(n.priceMax) && n.priceMax > 0 ? n.priceMax : null;
  if (price === null) return null;

  const priceCents = toCents(price);
  const discountPct =
    finite(n.priceDiscountRate) && n.priceDiscountRate > 0 && n.priceDiscountRate < 100
      ? Math.round(n.priceDiscountRate)
      : null;
  const originalPriceCents = discountPct ? Math.round(priceCents / (1 - discountPct / 100)) : null;
  // commissionRate vem como fração ("0.08" = 8%); por garantia aceita também "8".
  const commissionPct =
    finite(n.commissionRate) && n.commissionRate > 0
      ? Math.round((n.commissionRate <= 1 ? n.commissionRate * 100 : n.commissionRate) * 100) / 100
      : null;
  const commissionCents =
    finite(n.commission) && n.commission > 0
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

/**
 * Leitor de produtos com a credencial CENTRAL (mineração do catálogo e
 * prévia do "Divulgar link"). Não expõe nenhuma operação de link.
 */
export class ShopeeCatalogReader {
  private readonly client: ShopeeGraphqlClient;

  constructor(options: ShopeeClientOptions) {
    this.client = new ShopeeGraphqlClient(options);
  }

  async searchOffers(args: ProductOfferArgs, category: CatalogCategory): Promise<MinedProduct[]> {
    return parseProductOffers(await this.client.request(productOfferQuery(args)), category);
  }

  /** Um produto pelo itemId; null se a Shopee não devolver. */
  async getProduct(itemId: string): Promise<MinedProduct | null> {
    const [found] = await this.searchOffers({ itemId, page: 1, limit: 1 }, "OTHER");
    return found && found.externalId === itemId ? found : null;
  }
}
