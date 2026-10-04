// Minerador da Shopee para o catálogo central, com a credencial CENTRAL do
// sistema. Usa só o ShopeeCatalogReader (leitura): não tem como gerar link.
import type { CatalogCategory, MinedProduct } from "@achadinhos/db";
import { ShopeeCatalogReader, type ProductOfferArgs } from "@achadinhos/stores";
import type { CatalogMiner, MineResult, MinerStatus } from "./types";

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
  private readonly reader: ShopeeCatalogReader | null;

  constructor(private readonly options: ShopeeMinerOptions) {
    this.reader =
      options.appId && options.secret
        ? new ShopeeCatalogReader({
            appId: options.appId,
            secret: options.secret,
            ...(options.fetch ? { fetch: options.fetch } : {}),
          })
        : null;
  }

  status(): MinerStatus {
    return this.reader
      ? { enabled: true }
      : { enabled: false, reason: "Credencial central da Shopee não configurada (SHOPEE_CATALOG_APP_ID e SHOPEE_CATALOG_SECRET)." };
  }

  private requireReader(): ShopeeCatalogReader {
    if (!this.reader) throw new Error("Minerador da Shopee desligado.");
    return this.reader;
  }

  async mine(): Promise<MineResult> {
    const reader = this.requireReader();
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
        products.push(...(await reader.searchOffers(search.args, search.category)));
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
    const reader = this.requireReader();
    const sleep = this.options.sleep ?? defaultSleep;
    const result = new Map<string, MinedProduct | null>();
    for (const [index, itemId] of externalIds.entries()) {
      if (index > 0) await sleep(this.options.delayMs ?? 500);
      try {
        result.set(itemId, await reader.getProduct(itemId));
      } catch {
        // Erro de rede/cota: não desativa (só desativa quando a loja responde sem o produto).
      }
    }
    return result;
  }
}
