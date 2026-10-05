// Escolha da headline de uma mensagem conforme a configuração do cliente.
import type { CatalogCategory } from "@achadinhos/db";
import { captionProvider, HEADLINE_NO_REPEAT, type CaptionProduct, type CaptionProvider, type PickOptions } from "./provider";

export interface HeadlineSettings {
  /** Headline fixa (usada quando as automáticas estão desligadas e não há próprias). */
  headline: string;
  autoHeadlines: boolean;
  customHeadlines: string[];
}

export interface HeadlineProduct extends CaptionProduct {
  /** Pré-calculada no catálogo; sem ela, classifica pelo título. */
  headlineKey?: string | null;
}

/**
 * Automáticas ligadas: dicionário pelo tipo do produto (+ próprias do cliente no sorteio).
 * Desligadas: sorteia entre as próprias; sem próprias, usa a fixa.
 * Nos dois casos evita as 10 últimas do grupo e as já vistas ("Quero outra headline").
 */
export function chooseHeadline(
  settings: HeadlineSettings,
  product: HeadlineProduct,
  options: PickOptions = {},
  provider: CaptionProvider = captionProvider,
): string {
  const custom = settings.customHeadlines.map((h) => h.trim()).filter(Boolean);
  if (settings.autoHeadlines) {
    const key = product.headlineKey || provider.classify(product);
    return provider.pick(key, product, { ...options, extra: custom });
  }
  const pool = custom.length > 0 ? custom : [settings.headline];
  const recent = [options.recent ?? [], ...(options.recentByGroup ?? [])].flatMap((g) => g.slice(0, HEADLINE_NO_REPEAT));
  const avoid = new Set([...recent, ...(options.exclude ?? [])].map((h) => h.trim().toUpperCase()));
  const fresh = pool.filter((h) => !avoid.has(h.toUpperCase()));
  const list = fresh.length > 0 ? fresh : pool;
  const random = options.random ?? Math.random;
  return list[Math.floor(random() * list.length)] ?? settings.headline;
}

/**
 * Preenche headlineKey dos produtos minerados (antes de gravar no catálogo). Quando o tipo
 * tem categoria, ela corrige a da loja (`categoryFromType`: o catálogo grava por cima).
 */
export function withHeadlineKeys<
  T extends CaptionProduct & { category: CatalogCategory; headlineKey?: string | null; categoryFromType?: boolean },
>(products: T[], provider: CaptionProvider = captionProvider): T[] {
  return products.map((p) => {
    const headlineKey = provider.classify(p);
    const category = provider.categoryOf(headlineKey);
    return category ? { ...p, headlineKey, category, categoryFromType: true } : { ...p, headlineKey };
  });
}

/** Chave da headline + categoria corrigida pelo tipo (recalcular o catálogo). */
export function classifyForCatalog(
  product: CaptionProduct,
  provider: CaptionProvider = captionProvider,
): { headlineKey: string; category: CatalogCategory | null } {
  const headlineKey = provider.classify(product);
  return { headlineKey, category: provider.categoryOf(headlineKey) };
}
