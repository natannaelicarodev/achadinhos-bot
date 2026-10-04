import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  computeCatalogScore,
  deactivateCatalogProducts,
  findStaleCatalogProducts,
  listCatalog,
  normalizeSearchText,
  saveMinedProducts,
  stripAffiliateParams,
  toggleFavorite,
  type CatalogFilters,
  type MinedProduct,
} from "../src/catalog";
import { saveOfferForSending } from "../src/offers";
import { createTestDatabase, type TestDatabase } from "../src/testing";

let db: TestDatabase;
const HOUR = 60 * 60 * 1000;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.close();
});

function mined(externalId: string, extra: Partial<MinedProduct> = {}): MinedProduct {
  return {
    store: "SHOPEE",
    externalId,
    title: `Produto ${externalId}`,
    imageUrl: "https://cf.shopee.com.br/file/x",
    productUrl: `https://shopee.com.br/product/1/${externalId}`,
    category: "ELECTRONICS",
    priceCents: 5000,
    originalPriceCents: 10000,
    discountPct: 50,
    commissionPct: 8,
    commissionCents: 400,
    rating: 4.8,
    soldCount: 1000,
    ...extra,
  };
}

const filters = (extra: Partial<CatalogFilters> = {}): CatalogFilters => ({
  search: "",
  category: null,
  store: null,
  favoritesOnly: false,
  page: 1,
  ...extra,
});

async function newTenant(slug: string) {
  return db.prisma.tenant.create({ data: { name: slug, slug } });
}

describe("ranking e normalização", () => {
  it("mais vendas, nota, desconto e comissão = score maior; nota desconhecida é neutra", () => {
    const base = { soldCount: 100, rating: 4.6, discountPct: 10, commissionPct: 5 };
    expect(computeCatalogScore({ ...base, soldCount: 50_000 })).toBeGreaterThan(computeCatalogScore(base));
    expect(computeCatalogScore({ ...base, rating: 5 })).toBeGreaterThan(computeCatalogScore(base));
    expect(computeCatalogScore({ ...base, discountPct: 60 })).toBeGreaterThan(computeCatalogScore(base));
    expect(computeCatalogScore({ ...base, commissionPct: 15 })).toBeGreaterThan(computeCatalogScore(base));
    expect(computeCatalogScore({ soldCount: 100_000, rating: 5, discountPct: 70, commissionPct: 20 })).toBe(100);
    expect(computeCatalogScore({ soldCount: null, rating: null, discountPct: null, commissionPct: null })).toBe(12.5);
  });

  it("vendas pesam mais que desconto", () => {
    const popular = computeCatalogScore({ soldCount: 50_000, rating: 4.7, discountPct: 5, commissionPct: 5 });
    const discounted = computeCatalogScore({ soldCount: 10, rating: 4.7, discountPct: 60, commissionPct: 5 });
    expect(popular).toBeGreaterThan(discounted);
  });

  it("normaliza busca e limpa parâmetros de afiliado do link", () => {
    expect(normalizeSearchText("  Fone  Bluetooth SEM Fio Ação ")).toBe("fone bluetooth sem fio acao");
    expect(stripAffiliateParams("https://www.amazon.com.br/dp/B0X?tag=central-20&linkCode=ogi&th=1")).toBe(
      "https://www.amazon.com.br/dp/B0X?th=1",
    );
    expect(stripAffiliateParams("https://shopee.com.br/p-i.1.2?utm_source=x&smtt=0.0&sp_atk=abc")).toBe(
      "https://shopee.com.br/p-i.1.2",
    );
  });
});

describe("gravação da mineração", () => {
  it("cria, atualiza sem duplicar e ignora repetidos na mesma leva", async () => {
    const now = new Date("2026-10-07T10:00:00Z");
    const first = await saveMinedProducts(db.prisma, [mined("g1"), mined("g1"), mined("g2")], now);
    expect(first).toEqual({ upserted: 2, deactivated: 0 });

    const later = new Date(now.getTime() + HOUR);
    await saveMinedProducts(db.prisma, [mined("g1", { priceCents: 4000, title: "Fone Ação" })], later);
    const row = await db.prisma.catalogProduct.findUniqueOrThrow({
      where: { store_externalId: { store: "SHOPEE", externalId: "g1" } },
    });
    expect(row).toMatchObject({ priceCents: 4000, searchText: "fone acao", active: true });
    expect(row.lastSeenAt).toEqual(later);
    expect(await db.prisma.catalogProduct.count({ where: { externalId: { in: ["g1", "g2"] } } })).toBe(2);
  });

  it("nota abaixo de 4,5 não entra; se já estava, sai do catálogo", async () => {
    await saveMinedProducts(db.prisma, [mined("baixa", { rating: 4.4 })]);
    expect(await db.prisma.catalogProduct.count({ where: { externalId: "baixa" } })).toBe(0);

    await saveMinedProducts(db.prisma, [mined("caiu", { rating: 4.9 })]);
    const result = await saveMinedProducts(db.prisma, [mined("caiu", { rating: 4.2 })]);
    expect(result.deactivated).toBe(1);
    const row = await db.prisma.catalogProduct.findFirstOrThrow({ where: { externalId: "caiu" } });
    expect(row.active).toBe(false);
  });

  it("produto sem nota (Amazon) entra", async () => {
    await saveMinedProducts(db.prisma, [mined("sem-nota", { store: "AMAZON", rating: null, soldCount: null })]);
    expect(await db.prisma.catalogProduct.count({ where: { externalId: "sem-nota", active: true } })).toBe(1);
  });

  it("categoria só muda se a atual for OTHER", async () => {
    await saveMinedProducts(db.prisma, [mined("cat", { category: "OTHER" })]);
    await saveMinedProducts(db.prisma, [mined("cat", { category: "PETS" })]);
    await saveMinedProducts(db.prisma, [mined("cat", { category: "BEAUTY" })]);
    expect((await db.prisma.catalogProduct.findFirstOrThrow({ where: { externalId: "cat" } })).category).toBe("PETS");
  });

  it("lote grande: 1.200 produtos numa chamada (3 lotes), depois atualiza todos", async () => {
    const now = new Date("2026-10-07T12:00:00Z");
    const many = Array.from({ length: 1200 }, (_, i) =>
      mined(`lote-${i}`, { category: i % 2 ? "PETS" : "BEAUTY", soldCount: i, rating: i % 10 === 0 ? 4.0 : 4.9 }),
    );
    const result = await saveMinedProducts(db.prisma, many, now);
    expect(result).toEqual({ upserted: 1080, deactivated: 0 }); // 120 com nota 4,0 ficam de fora
    expect(await db.prisma.catalogProduct.count({ where: { externalId: { startsWith: "lote-" } } })).toBe(1080);

    const later = new Date(now.getTime() + HOUR);
    const again = await saveMinedProducts(
      db.prisma,
      many.map((p) => ({ ...p, priceCents: 1234, category: "HEALTH" as const })),
      later,
    );
    expect(again.upserted).toBe(1080);
    const sample = await db.prisma.catalogProduct.findFirstOrThrow({ where: { externalId: "lote-7" } });
    // Preço atualizado; categoria mantida (só troca se era OTHER); lastSeenAt avançou.
    expect(sample).toMatchObject({ priceCents: 1234, category: "PETS", soldCount: 7, active: true });
    expect(sample.lastSeenAt).toEqual(later);
    expect(sample.score).toBeGreaterThan(0);
    expect(await db.prisma.catalogProduct.count({ where: { externalId: { startsWith: "lote-" } } })).toBe(1080);
  });

  it("tudo ou nada: se o banco falhar no meio do lote, nenhum produto muda", async () => {
    await saveMinedProducts(db.prisma, [mined("atom-0", { priceCents: 100 })]);
    await db.prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_on_boom() RETURNS trigger AS $$
      BEGIN
        IF NEW."externalId" = 'atom-boom' THEN RAISE EXCEPTION 'falha simulada'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
    `);
    await db.prisma.$executeRawUnsafe(
      `CREATE TRIGGER boom BEFORE INSERT ON "CatalogProduct" FOR EACH ROW EXECUTE FUNCTION fail_on_boom()`,
    );
    try {
      // 700 produtos: o que falha está no 2º lote; o 1º lote (com atom-0 atualizado) também precisa voltar.
      const batch = [
        mined("atom-0", { priceCents: 999 }),
        ...Array.from({ length: 698 }, (_, i) => mined(`atom-${i + 1}`)),
        mined("atom-boom"),
      ];
      await expect(saveMinedProducts(db.prisma, batch)).rejects.toThrow();
    } finally {
      await db.prisma.$executeRawUnsafe(`DROP TRIGGER boom ON "CatalogProduct"`);
    }
    expect((await db.prisma.catalogProduct.findFirstOrThrow({ where: { externalId: "atom-0" } })).priceCents).toBe(100);
    expect(await db.prisma.catalogProduct.count({ where: { externalId: { startsWith: "atom-" } } })).toBe(1);
  });

  it("nunca grava parâmetro de afiliado no link", async () => {
    await saveMinedProducts(db.prisma, [
      mined("link", { store: "AMAZON", productUrl: "https://www.amazon.com.br/dp/B0LINK?tag=central-20" }),
    ]);
    const row = await db.prisma.catalogProduct.findFirstOrThrow({ where: { externalId: "link" } });
    expect(row.productUrl).toBe("https://www.amazon.com.br/dp/B0LINK");
  });

  it("produtos parados há mais de 24h são listados para reconferir; os sumidos ficam inativos", async () => {
    const old = new Date("2026-01-01T00:00:00Z");
    await saveMinedProducts(db.prisma, [mined("velho1"), mined("velho2")], old);
    const stale = await findStaleCatalogProducts(db.prisma, "SHOPEE", new Date("2026-01-02T00:00:00Z"), 10);
    expect(stale.map((s) => s.externalId).sort()).toEqual(["velho1", "velho2"]);

    expect(await deactivateCatalogProducts(db.prisma, "SHOPEE", ["velho1"])).toBe(1);
    expect((await db.prisma.catalogProduct.findFirstOrThrow({ where: { externalId: "velho1" } })).active).toBe(false);
  });
});

describe("catálogo no painel", () => {
  beforeAll(async () => {
    await db.prisma.catalogProduct.updateMany({ data: { active: false } });
    await saveMinedProducts(db.prisma, [
      mined("p-fone", { title: "Fone Bluetooth Sem Fio", category: "ELECTRONICS", soldCount: 90_000 }),
      mined("p-racao", { title: "Ração Premium Cães", category: "PETS", soldCount: 5_000 }),
      mined("p-batom", { title: "Batom Matte", category: "BEAUTY", store: "AMAZON", rating: null }),
      ...Array.from({ length: 30 }, (_, i) => mined(`p-casa-${i}`, { title: `Utensílio ${i}`, category: "HOME_KITCHEN_DECOR", soldCount: i })),
    ]);
  });

  it("filtra por categoria, loja e busca sem acento; ordena por score", async () => {
    const t = await newTenant("cat-lista");
    const opts = { client: db.prisma };
    expect((await listCatalog(t.id, filters({ category: "PETS" }), opts)).items.map((p) => p.externalId)).toEqual([
      "p-racao",
    ]);
    expect((await listCatalog(t.id, filters({ store: "AMAZON" }), opts)).items.map((p) => p.externalId)).toEqual([
      "p-batom",
    ]);
    expect((await listCatalog(t.id, filters({ search: "RACAO caes" }), opts)).total).toBe(1);
    const all = await listCatalog(t.id, filters(), opts);
    expect(all.items[0]?.externalId).toBe("p-fone");
  });

  it("pagina de 24 em 24 e esconde inativos", async () => {
    const t = await newTenant("cat-pagina");
    const page1 = await listCatalog(t.id, filters(), { client: db.prisma });
    const page2 = await listCatalog(t.id, filters({ page: 2 }), { client: db.prisma });
    expect(page1.total).toBe(33);
    expect(page1.pages).toBe(2);
    expect(page1.items).toHaveLength(24);
    expect(page2.items).toHaveLength(9);
    expect(page1.items.every((p) => p.active)).toBe(true);
  });

  it("favoritos são por tenant", async () => {
    const a = await newTenant("fav-a");
    const b = await newTenant("fav-b");
    const fone = await db.prisma.catalogProduct.findFirstOrThrow({ where: { externalId: "p-fone" } });
    const opts = { client: db.prisma };

    expect(await toggleFavorite(a.id, fone.id, opts)).toBe(true);
    const favA = await listCatalog(a.id, filters({ favoritesOnly: true }), opts);
    expect(favA.items.map((p) => [p.externalId, p.isFavorite])).toEqual([["p-fone", true]]);
    expect((await listCatalog(b.id, filters({ favoritesOnly: true }), opts)).total).toBe(0);

    expect(await toggleFavorite(a.id, fone.id, opts)).toBe(false);
    expect((await listCatalog(a.id, filters({ favoritesOnly: true }), opts)).total).toBe(0);
    expect(await toggleFavorite(a.id, "nao-existe", opts)).toBeNull();
  });

  it("produto já divulgado aparece marcado (hasOffer) só para o tenant que divulgou", async () => {
    const t = await newTenant("divulgar");
    const other = await newTenant("divulgar-outro");
    const fone = await db.prisma.catalogProduct.findFirstOrThrow({ where: { externalId: "p-fone" } });
    const opts = { client: db.prisma };
    await saveOfferForSending(
      t.id,
      {
        catalogProductId: fone.id,
        store: fone.store,
        externalId: fone.externalId,
        title: fone.title,
        url: fone.productUrl,
        affiliateUrl: "https://s.shopee.com.br/x",
        imageUrl: null,
        priceCents: fone.priceCents,
        originalPriceCents: null,
        messageText: "msg",
      },
      opts,
    );
    expect((await listCatalog(t.id, filters({ search: "fone" }), opts)).items[0]?.hasOffer).toBe(true);
    expect((await listCatalog(other.id, filters({ search: "fone" }), opts)).items[0]?.hasOffer).toBe(false);
  });
});
