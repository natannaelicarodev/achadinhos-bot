import { describe, expect, it } from "vitest";
import { catalogHref, CATALOG_STORES, formatCommission, formatSold, parseCatalogFilters } from "@/lib/catalog";

describe("filtros do catálogo (URL)", () => {
  it("padrão: sem filtros, página 1", () => {
    expect(parseCatalogFilters({})).toEqual({ search: "", category: null, store: null, favoritesOnly: false, page: 1 });
  });

  it("lê busca, categoria, loja, favoritos e página", () => {
    expect(
      parseCatalogFilters({ busca: " fone ", categoria: "PETS", loja: "SHOPEE", favoritos: "1", pagina: "3" }),
    ).toEqual({ search: "fone", category: "PETS", store: "SHOPEE", favoritesOnly: true, page: 3 });
  });

  it("ignora valores inválidos (e Mercado Livre não é loja do catálogo)", () => {
    expect(parseCatalogFilters({ categoria: "ARMAS", loja: "MERCADO_LIVRE", pagina: "-2" })).toMatchObject({
      category: null,
      store: null,
      page: 1,
    });
    expect(parseCatalogFilters({ categoria: "OTHER" }).category).toBeNull();
  });

  it("catalogHref troca só o que mudou e volta para a página 1", () => {
    const current = parseCatalogFilters({ busca: "fone", categoria: "ELECTRONICS", pagina: "4" });
    expect(catalogHref(current, { store: "SHOPEE" })).toBe("/painel/catalogo?busca=fone&categoria=ELECTRONICS&loja=SHOPEE");
    expect(catalogHref(current, { page: 5 })).toBe("/painel/catalogo?busca=fone&categoria=ELECTRONICS&pagina=5");
    expect(catalogHref(parseCatalogFilters({}), {})).toBe("/painel/catalogo");
  });

  it("filtro Mercado Livre é um atalho para Divulgar link", () => {
    expect(CATALOG_STORES.find((s) => s.value === "MERCADO_LIVRE")?.href).toBe("/painel/divulgar-link");
  });

  it("formata comissão e vendidos", () => {
    // Intl usa espaço não separável depois do "R$".
    expect(formatCommission(479, 8).replace(/\s/g, " ")).toBe("R$ 4,79 (8%)");
    expect(formatCommission(null, null)).toBe("—");
    expect(formatSold(12500)).toBe("12,5 mil vendidos");
    expect(formatSold(null)).toBe("—");
  });
});
