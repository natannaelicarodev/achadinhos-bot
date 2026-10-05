// Catálogo central (global): gravação da mineração, ranking e consultas do painel.
import { randomUUID } from "node:crypto";
import { Prisma, type CatalogCategory, type PrismaClient, type Store } from "./generated/prisma/client";
import { forTenant } from "./tenant";

/** Nota mínima para entrar (ou continuar) no catálogo, quando a loja informa a nota. */
export const MIN_CATALOG_RATING = 4.5;
export const CATALOG_PAGE_SIZE = 24;
/**
 * Mercado Livre vem da vitrine compartilhada (extensão do administrador), não de um
 * minerador com "reconferir": produto que não volta na vitrine em 48h some do catálogo.
 */
export const MERCADO_LIVRE_STALE_HOURS = 48;

/** Produto como vem de um minerador (já convertido para centavos e %). */
export interface MinedProduct {
  store: Store;
  externalId: string;
  title: string;
  imageUrl: string | null;
  /** Link LIMPO da loja. Nunca link de afiliado. */
  productUrl: string;
  category: CatalogCategory;
  priceCents: number;
  originalPriceCents: number | null;
  discountPct: number | null;
  commissionPct: number | null;
  commissionCents: number | null;
  rating: number | null;
  soldCount: number | null;
}

/** Minúsculas, sem acento e com espaços simples: base da busca do catálogo. */
export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Ranking 0–100: vendas (45%), nota (25%), desconto (15%), comissão % (15%).
 * Vendas em escala log (100 mil vendidos = máximo). Nota desconhecida = neutra.
 */
export function computeCatalogScore(p: Pick<MinedProduct, "soldCount" | "rating" | "discountPct" | "commissionPct">) {
  const sales = clamp01(Math.log10((p.soldCount ?? 0) + 1) / 5);
  const rating = p.rating === null ? 0.5 : clamp01((p.rating - MIN_CATALOG_RATING) / (5 - MIN_CATALOG_RATING));
  const discount = clamp01((p.discountPct ?? 0) / 70);
  const commission = clamp01((p.commissionPct ?? 0) / 20);
  return Math.round((0.45 * sales + 0.25 * rating + 0.15 * discount + 0.15 * commission) * 10_000) / 100;
}

/** Remove parâmetros de rastreio/afiliado. Defesa extra: o catálogo só guarda links limpos. */
const AFFILIATE_PARAMS = [/^tag$/i, /^ascsubtag$/i, /^linkcode$/i, /^aff/i, /^utm_/i, /^smtt$/i, /^sp_atk$/i, /^xptdk$/i];
export function stripAffiliateParams(rawUrl: string): string {
  const url = new URL(rawUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (AFFILIATE_PARAMS.some((re) => re.test(key))) url.searchParams.delete(key);
  }
  url.hash = "";
  return url.toString();
}

function toRow(p: MinedProduct, now: Date) {
  return {
    title: p.title,
    searchText: normalizeSearchText(p.title),
    imageUrl: p.imageUrl,
    productUrl: stripAffiliateParams(p.productUrl),
    priceCents: p.priceCents,
    originalPriceCents: p.originalPriceCents,
    discountPct: p.discountPct,
    commissionPct: p.commissionPct,
    commissionCents: p.commissionCents,
    rating: p.rating,
    soldCount: p.soldCount,
    score: computeCatalogScore(p),
    active: true,
    lastSeenAt: now,
  };
}

/** Produtos por comando SQL (19 parâmetros por linha; o Postgres aceita até 65.535). */
const UPSERT_BATCH = 500;
const SAVE_TX_TIMEOUT_MS = 120_000;

function upsertStatement(rows: { p: MinedProduct; row: ReturnType<typeof toRow> }[], now: Date) {
  const values = rows.map(({ p, row }) =>
    Prisma.sql`(${randomUUID()}, ${p.store}::"Store", ${p.externalId}, ${row.title}, ${row.searchText}, ${row.imageUrl},
      ${row.productUrl}, ${p.category}::"CatalogCategory", ${row.priceCents}::int, ${row.originalPriceCents}::int,
      ${row.discountPct}::int, ${row.commissionPct}::double precision, ${row.commissionCents}::int,
      ${row.rating}::double precision, ${row.soldCount}::int, ${row.score}::double precision, true,
      ${now}::timestamp(3), ${now}::timestamp(3))`,
  );
  // Categoria só muda se a atual for OTHER (a primeira classificação vale).
  return Prisma.sql`
    INSERT INTO "CatalogProduct" ("id", "store", "externalId", "title", "searchText", "imageUrl", "productUrl",
      "category", "priceCents", "originalPriceCents", "discountPct", "commissionPct", "commissionCents", "rating",
      "soldCount", "score", "active", "lastSeenAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("store", "externalId") DO UPDATE SET
      "title" = EXCLUDED."title",
      "searchText" = EXCLUDED."searchText",
      "imageUrl" = EXCLUDED."imageUrl",
      "productUrl" = EXCLUDED."productUrl",
      "category" = CASE WHEN "CatalogProduct"."category" = 'OTHER' THEN EXCLUDED."category" ELSE "CatalogProduct"."category" END,
      "priceCents" = EXCLUDED."priceCents",
      "originalPriceCents" = EXCLUDED."originalPriceCents",
      "discountPct" = EXCLUDED."discountPct",
      "commissionPct" = EXCLUDED."commissionPct",
      "commissionCents" = EXCLUDED."commissionCents",
      "rating" = EXCLUDED."rating",
      "soldCount" = EXCLUDED."soldCount",
      "score" = EXCLUDED."score",
      "active" = true,
      "lastSeenAt" = EXCLUDED."lastSeenAt",
      "updatedAt" = EXCLUDED."updatedAt"`;
}

/**
 * Grava produtos minerados em lote, numa única transação (tudo ou nada).
 * Nota abaixo de 4,5 não entra; se já estava no catálogo, fica inativo.
 * Categoria só é trocada se a atual for OTHER. O catálogo é global (sem
 * tenant), por isso SQL direto aqui não fere a regra de multi-tenant.
 */
export async function saveMinedProducts(client: PrismaClient, products: MinedProduct[], now: Date = new Date()) {
  // Um produto aparece uma vez por leva (o primeiro vence: mantém a categoria da busca que o achou).
  const unique = new Map<string, MinedProduct>();
  for (const p of products) {
    const key = `${p.store}:${p.externalId}`;
    if (!unique.has(key)) unique.set(key, p);
  }

  const lowRated: MinedProduct[] = [];
  const toSave: { p: MinedProduct; row: ReturnType<typeof toRow> }[] = [];
  for (const p of unique.values()) {
    if (p.rating !== null && p.rating < MIN_CATALOG_RATING) lowRated.push(p);
    else toSave.push({ p, row: toRow(p, now) });
  }

  const operations: Prisma.PrismaPromise<unknown>[] = [];
  const lowByStore = new Map<Store, string[]>();
  for (const p of lowRated) lowByStore.set(p.store, [...(lowByStore.get(p.store) ?? []), p.externalId]);
  for (const [store, externalIds] of lowByStore) {
    operations.push(
      client.catalogProduct.updateMany({
        where: { store, externalId: { in: externalIds }, active: true },
        data: { active: false, lastSeenAt: now },
      }),
    );
  }
  const deactivateCount = operations.length;
  for (let i = 0; i < toSave.length; i += UPSERT_BATCH) {
    operations.push(client.$executeRaw(upsertStatement(toSave.slice(i, i + UPSERT_BATCH), now)));
  }
  if (operations.length === 0) return { upserted: 0, deactivated: 0 };

  const results = await client.$transaction(operations, { timeout: SAVE_TX_TIMEOUT_MS, maxWait: SAVE_TX_TIMEOUT_MS });
  const deactivated = results
    .slice(0, deactivateCount)
    .reduce<number>((sum, r) => sum + (r as { count: number }).count, 0);
  return { upserted: toSave.length, deactivated };
}

/** Ativos que não apareceram na mineração desde `olderThan` (para reconferir na loja). */
export function findStaleCatalogProducts(client: PrismaClient, store: Store, olderThan: Date, limit: number) {
  return client.catalogProduct.findMany({
    where: { store, active: true, lastSeenAt: { lt: olderThan } },
    orderBy: { lastSeenAt: "asc" },
    take: limit,
    select: { externalId: true },
  });
}

/** Produtos que a loja não devolveu mais: saem do catálogo (active=false). */
export async function deactivateCatalogProducts(client: PrismaClient, store: Store, externalIds: string[]) {
  if (externalIds.length === 0) return 0;
  const { count } = await client.catalogProduct.updateMany({
    where: { store, externalId: { in: externalIds }, active: true },
    data: { active: false },
  });
  return count;
}

// ---------- Painel ----------

export interface CatalogFilters {
  search: string;
  category: CatalogCategory | null;
  store: Store | null;
  favoritesOnly: boolean;
  page: number;
}

/** Página do catálogo para o tenant (com a marcação de favorito e de oferta criada). */
export async function listCatalog(
  tenantId: string,
  filters: CatalogFilters,
  options: { client?: PrismaClient; now?: Date } = {},
) {
  const db = forTenant(tenantId, options.client);
  const terms = normalizeSearchText(filters.search).split(" ").filter(Boolean);
  const mlCutoff = new Date((options.now ?? new Date()).getTime() - MERCADO_LIVRE_STALE_HOURS * 3_600_000);

  const where: Prisma.CatalogProductWhereInput = {
    active: true,
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.store ? { store: filters.store } : {}),
    ...(terms.length ? { AND: terms.map((term) => ({ searchText: { contains: term } })) } : {}),
    NOT: { store: "MERCADO_LIVRE", lastSeenAt: { lt: mlCutoff } },
  };
  if (filters.favoritesOnly) {
    const favorites = await db.favorite.findMany({ select: { catalogProductId: true } });
    where.id = { in: favorites.map((f) => f.catalogProductId) };
  }

  const page = Math.max(1, filters.page);
  const [total, products] = await Promise.all([
    db.catalogProduct.count({ where }),
    db.catalogProduct.findMany({
      where,
      orderBy: [{ score: "desc" }, { id: "asc" }],
      skip: (page - 1) * CATALOG_PAGE_SIZE,
      take: CATALOG_PAGE_SIZE,
    }),
  ]);

  const ids = products.map((p) => p.id);
  const [favorites, offers] = await Promise.all([
    db.favorite.findMany({ where: { catalogProductId: { in: ids } }, select: { catalogProductId: true } }),
    db.offer.findMany({ where: { catalogProductId: { in: ids } }, select: { catalogProductId: true } }),
  ]);
  const favoriteIds = new Set(favorites.map((f) => f.catalogProductId));
  const offerIds = new Set(offers.map((o) => o.catalogProductId));

  return {
    items: products.map((p) => ({ ...p, isFavorite: favoriteIds.has(p.id), hasOffer: offerIds.has(p.id) })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE)),
  };
}

/** Liga/desliga o favorito do tenant. Retorna o estado final. */
export async function toggleFavorite(tenantId: string, catalogProductId: string, options: { client?: PrismaClient } = {}) {
  const db = forTenant(tenantId, options.client);
  const product = await db.catalogProduct.findUnique({ where: { id: catalogProductId }, select: { id: true } });
  if (!product) return null;
  const { count } = await db.favorite.deleteMany({ where: { catalogProductId } });
  if (count > 0) return false;
  await db.favorite.create({ data: { tenantId, catalogProductId } });
  return true;
}

/** Última execução da mineração por loja (rodapé do catálogo). */
export async function getLatestMiningRuns(client: PrismaClient) {
  const stores: Store[] = ["SHOPEE", "AMAZON", "MERCADO_LIVRE"];
  return Promise.all(
    stores.map((store) =>
      client.catalogMiningRun.findFirst({ where: { store }, orderBy: { startedAt: "desc" } }),
    ),
  );
}
