import { computeCatalogScore } from "@achadinhos/db";
import { describe, expect, it } from "vitest";
import { AMAZON_POPULARITY_PER_RATING, amazonVitrinePayloadSchema, amazonVitrineToMinedProducts } from "@/lib/amazon-vitrine";
import { AMAZON_BESTSELLER_CATEGORIES } from "@/lib/catalog";

const item = (asin: string, extra: Record<string, unknown> = {}) => ({
  asin,
  rank: 1,
  productUrl: `https://www.amazon.com.br/dp/${asin}`,
  title: `Produto ${asin}`,
  imageUrl: "https://images-na.ssl-images-amazon.com/images/I/51653ltvYsL.jpg",
  priceCents: 2124,
  rating: 4.9,
  ratingsCount: 26113,
  ...extra,
});

describe("vitrine compartilhada da Amazon (mais vendidos)", () => {
  it("categoria vem da página de mais vendidos (Alimentos = grocery); sem vendidos nem comissão", () => {
    const payload = amazonVitrinePayloadSchema.parse({ batches: [{ slug: "grocery", items: [item("B097BYXGXN")] }] });
    const [p] = amazonVitrineToMinedProducts(payload);
    expect(p).toMatchObject({
      store: "AMAZON",
      externalId: "B097BYXGXN",
      category: "FOOD_BEVERAGES",
      productUrl: "https://www.amazon.com.br/dp/B097BYXGXN",
      soldCount: null,
      commissionPct: null,
      popularity: 26113 * AMAZON_POPULARITY_PER_RATING,
    });
  });

  it("descarta link com etiqueta, imagem fora da Amazon, ASIN inválido e categoria desconhecida", () => {
    const payload = amazonVitrinePayloadSchema.parse({
      batches: [
        {
          slug: "beauty",
          items: [
            item("B000000001", { productUrl: "https://www.amazon.com.br/dp/B000000001?tag=outra-20" }),
            item("B000000002", { imageUrl: "https://evil.example/x.jpg" }),
            item("nao-e-asin"),
            item("B000000003"),
          ],
        },
        { slug: "books", items: [item("B000000004")] },
      ],
    });
    expect(amazonVitrineToMinedProducts(payload).map((p) => p.externalId)).toEqual(["B000000003"]);
  });

  it("as 8 categorias do painel têm mais vendidos da Amazon", () => {
    expect(new Set(Object.values(AMAZON_BESTSELLER_CATEGORIES)).size).toBe(8);
  });

  it("ranking: avaliações da Amazon contam como popularidade (sem vendidos)", () => {
    const base = { soldCount: null, rating: 4.8, discountPct: null, commissionPct: null };
    expect(computeCatalogScore({ ...base, popularity: 100_000 })).toBeGreaterThan(computeCatalogScore(base));
    expect(computeCatalogScore({ ...base, soldCount: 10, popularity: 100_000 })).toBe(computeCatalogScore({ ...base, soldCount: 10 }));
  });
});
