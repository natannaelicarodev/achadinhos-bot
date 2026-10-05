import type { CatalogCategory, CatalogFilters, Store } from "@achadinhos/db";
import {
  AppleIcon,
  BabyIcon,
  HeartPulseIcon,
  PawPrintIcon,
  ShirtIcon,
  SmartphoneIcon,
  SofaIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";

export const CATEGORIES: { value: Exclude<CatalogCategory, "OTHER">; label: string; icon: LucideIcon }[] = [
  { value: "FOOD_BEVERAGES", label: "Alimentos e Bebidas", icon: AppleIcon },
  { value: "BEAUTY", label: "Beleza", icon: SparklesIcon },
  { value: "HOME_KITCHEN_DECOR", label: "Casa, Cozinha e Decoração", icon: SofaIcon },
  { value: "ELECTRONICS", label: "Eletrônicos", icon: SmartphoneIcon },
  { value: "KIDS_BABY", label: "Infantil e Baby", icon: BabyIcon },
  { value: "FASHION", label: "Moda", icon: ShirtIcon },
  { value: "PETS", label: "Pets", icon: PawPrintIcon },
  { value: "HEALTH", label: "Saúde", icon: HeartPulseIcon },
];

export const CATEGORY_LABEL: Record<CatalogCategory, string> = {
  ...(Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label])) as Record<Exclude<CatalogCategory, "OTHER">, string>),
  OTHER: "Outros",
};

/**
 * Lojas do catálogo. Mercado Livre vem da vitrine compartilhada (extensão do
 * administrador envia a vitrine do portal de afiliados ao catálogo central).
 */
export const CATALOG_STORES: { value: Store; label: string; className: string }[] = [
  { value: "SHOPEE", label: "Shopee", className: "bg-orange-500 text-white" },
  { value: "MERCADO_LIVRE", label: "Mercado Livre", className: "bg-yellow-300 text-yellow-950" },
  { value: "AMAZON", label: "Amazon", className: "bg-neutral-900 text-white" },
];

/** Categorias do catálogo <-> código de categoria do Mercado Livre (vitrine do portal de afiliados). */
// Alimentos e Bebidas NÃO existe nas categorias do portal de afiliados: vem por palavra-chave.
export const ML_CATEGORY_IDS: Partial<Record<Exclude<CatalogCategory, "OTHER">, string>> = {
  BEAUTY: "MLB1246", // Beleza e Cuidado Pessoal (confirmado no portal)
  HOME_KITCHEN_DECOR: "MLB1574", // Casa, Móveis e Decoração
  ELECTRONICS: "MLB1000", // Eletrônicos, Áudio e Vídeo
  KIDS_BABY: "MLB1384", // Bebês
  FASHION: "MLB1430", // Calçados, Roupas e Bolsas
  PETS: "MLB1071", // Animais
  HEALTH: "MLB264586", // Saúde
};

/**
 * Amazon: páginas de "Mais vendidos" (amazon.com.br/gp/bestsellers/{slug}) -> categoria do catálogo.
 * Conferidas em 10/2026: todas abrem e trazem 30 produtos por página.
 */
export const AMAZON_BESTSELLER_CATEGORIES: Record<string, Exclude<CatalogCategory, "OTHER">> = {
  grocery: "FOOD_BEVERAGES", // Alimentos e Bebidas
  beauty: "BEAUTY",
  kitchen: "HOME_KITCHEN_DECOR",
  home: "HOME_KITCHEN_DECOR",
  electronics: "ELECTRONICS",
  "baby-products": "KIDS_BABY",
  toys: "KIDS_BABY",
  fashion: "FASHION",
  "pet-products": "PETS",
  hpc: "HEALTH", // Saúde e Cuidados Pessoais
};

/**
 * Buscas por palavra na vitrine do ML (categorias que o portal não tem) -> categoria do catálogo.
 * VAZIO de propósito: testado em 10/2026, o portal quase não tem comida/bebida (a busca por
 * "chocolate", "café", "vinho"... devolve utensílios e roupas; sobraram 4 produtos após o filtro
 * isFoodTitle). Alimentos fica com a Shopee. Para reativar: palavra -> categoria aqui.
 */
export const ML_KEYWORD_SEARCHES: Record<string, Exclude<CatalogCategory, "OTHER">> = {};

const SHEIN_BADGE = { label: "Shein", className: "bg-black text-white" };

export const STORE_LABEL: Partial<Record<Store, { label: string; className: string }>> = {
  ...Object.fromEntries(CATALOG_STORES.map((s) => [s.value, { label: s.label, className: s.className }])),
  SHEIN: SHEIN_BADGE,
};

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const CATALOG_STORE_VALUES = new Set<Store>(["SHOPEE", "AMAZON", "MERCADO_LIVRE"]);
const CATEGORY_VALUES = new Set<string>(CATEGORIES.map((c) => c.value));

/** Filtros vindos da URL: ?busca=&categoria=&loja=&favoritos=1&pagina= (valores inválidos são ignorados). */
export function parseCatalogFilters(params: Params): CatalogFilters {
  const category = first(params.categoria);
  const store = first(params.loja) as Store;
  const page = Number.parseInt(first(params.pagina), 10);
  return {
    search: first(params.busca).trim().slice(0, 100),
    category: CATEGORY_VALUES.has(category) ? (category as CatalogCategory) : null,
    store: CATALOG_STORE_VALUES.has(store) ? store : null,
    favoritesOnly: first(params.favoritos) === "1",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 1000) : 1,
  };
}

/** Monta a URL do catálogo trocando só o que mudou (e volta para a página 1 ao filtrar). */
export function catalogHref(current: CatalogFilters, change: Partial<CatalogFilters>): string {
  const next = { ...current, page: 1, ...change };
  const params = new URLSearchParams();
  if (next.search) params.set("busca", next.search);
  if (next.category) params.set("categoria", next.category);
  if (next.store) params.set("loja", next.store);
  if (next.favoritesOnly) params.set("favoritos", "1");
  if (next.page > 1) params.set("pagina", String(next.page));
  const query = params.toString();
  return query ? `/painel/catalogo?${query}` : "/painel/catalogo";
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatBRL = (cents: number) => brl.format(cents / 100);

export function formatCommission(cents: number | null, pct: number | null): string {
  if (cents === null && pct === null) return "—";
  const pctText = pct === null ? "" : `${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  if (cents === null) return pctText;
  return pct === null ? formatBRL(cents) : `${formatBRL(cents)} (${pctText})`;
}

export function formatSold(count: number | null): string {
  if (count === null) return "—";
  if (count >= 1000) return `${(count / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil vendidos`;
  return `${count} vendidos`;
}
