import { describe, expect, it } from "vitest";
import { catalogHref, CATALOG_STORES, formatCommission, formatSold, ML_CATEGORY_IDS, ML_KEYWORD_SEARCHES, parseCatalogFilters } from "@/lib/catalog";

describe("filtros do catálogo (URL)", () => {
  it("padrão: sem filtros, página 1", () => {
    expect(parseCatalogFilters({})).toEqual({ search: "", category: null, store: null, favoritesOnly: false, page: 1 });
  });

  it("lê busca, categoria, loja, favoritos e página", () => {
    expect(
      parseCatalogFilters({ busca: " fone ", categoria: "PETS", loja: "SHOPEE", favoritos: "1", pagina: "3" }),
    ).toEqual({ search: "fone", category: "PETS", store: "SHOPEE", favoritesOnly: true, page: 3 });
  });

  it("ignora valores inválidos", () => {
    expect(parseCatalogFilters({ categoria: "ARMAS", loja: "MAGALU", pagina: "-2" })).toMatchObject({
      category: null,
      store: null,
      page: 1,
    });
    expect(parseCatalogFilters({ categoria: "OTHER" }).category).toBeNull();
  });

  it("Mercado Livre é loja do catálogo (vitrine ao vivo pela extensão)", () => {
    expect(parseCatalogFilters({ loja: "MERCADO_LIVRE" }).store).toBe("MERCADO_LIVRE");
  });

  it("catalogHref troca só o que mudou e volta para a página 1", () => {
    const current = parseCatalogFilters({ busca: "fone", categoria: "ELECTRONICS", pagina: "4" });
    expect(catalogHref(current, { store: "SHOPEE" })).toBe("/painel/catalogo?busca=fone&categoria=ELECTRONICS&loja=SHOPEE");
    expect(catalogHref(current, { page: 5 })).toBe("/painel/catalogo?busca=fone&categoria=ELECTRONICS&pagina=5");
    expect(catalogHref(parseCatalogFilters({}), {})).toBe("/painel/catalogo");
  });

  it("categorias do Mercado Livre: 7 por código do portal (o portal não tem Alimentos)", () => {
    expect(CATALOG_STORES.map((s) => s.value)).toContain("MERCADO_LIVRE");
    expect(Object.values(ML_CATEGORY_IDS).every((id) => /^MLB\d+$/.test(id))).toBe(true);
    expect(Object.keys(ML_CATEGORY_IDS)).toHaveLength(7);
    expect(ML_CATEGORY_IDS.FOOD_BEVERAGES).toBeUndefined();
    expect(Object.keys(ML_KEYWORD_SEARCHES)).toHaveLength(0);
    expect(ML_CATEGORY_IDS.BEAUTY).toBe("MLB1246");
  });

  it("formata comissão e vendidos", () => {
    // Intl usa espaço não separável depois do "R$".
    expect(formatCommission(479, 8).replace(/\s/g, " ")).toBe("R$ 4,79 (8%)");
    expect(formatCommission(null, null)).toBe("—");
    expect(formatSold(12500)).toBe("12,5 mil vendidos");
    expect(formatSold(null)).toBe("—");
  });
});
