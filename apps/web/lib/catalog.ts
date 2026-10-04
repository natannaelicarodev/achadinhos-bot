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

/** Lojas do catálogo. Mercado Livre não é minerado: o filtro leva para "Divulgar link". */
export const CATALOG_STORES: { value: Store; label: string; className: string; href?: string }[] = [
  { value: "SHOPEE", label: "Shopee", className: "bg-orange-500 text-white" },
  { value: "MERCADO_LIVRE", label: "Mercado Livre", className: "bg-yellow-300 text-yellow-950", href: "/painel/divulgar-link" },
  { value: "AMAZON", label: "Amazon", className: "bg-neutral-900 text-white" },
];

const SHEIN_BADGE = { label: "Shein", className: "bg-black text-white" };

export const STORE_LABEL: Partial<Record<Store, { label: string; className: string }>> = {
  ...Object.fromEntries(CATALOG_STORES.map((s) => [s.value, { label: s.label, className: s.className }])),
  SHEIN: SHEIN_BADGE,
};

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const MINED_STORES = new Set<Store>(["SHOPEE", "AMAZON"]);
const CATEGORY_VALUES = new Set<string>(CATEGORIES.map((c) => c.value));

/** Filtros vindos da URL: ?busca=&categoria=&loja=&favoritos=1&pagina= (valores inválidos são ignorados). */
export function parseCatalogFilters(params: Params): CatalogFilters {
  const category = first(params.categoria);
  const store = first(params.loja) as Store;
  const page = Number.parseInt(first(params.pagina), 10);
  return {
    search: first(params.busca).trim().slice(0, 100),
    category: CATEGORY_VALUES.has(category) ? (category as CatalogCategory) : null,
    store: MINED_STORES.has(store) ? store : null,
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
