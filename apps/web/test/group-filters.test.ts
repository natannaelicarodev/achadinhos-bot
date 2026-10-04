import { describe, expect, it } from "vitest";
import { filterGroups, normalizeForSearch, parseGroupFilters } from "@/lib/whatsapp";

const groups = [
  { name: "Promoções Relâmpago SP", isAdmin: true },
  { name: "Achadinhos da Ana", isAdmin: true },
  { name: "Família", isAdmin: false },
  { name: "Promo Tech", isAdmin: false },
];

describe("filtros da lista de grupos", () => {
  it("padrão (sem parâmetros na URL): só admin, sem busca", () => {
    expect(parseGroupFilters({})).toEqual({ search: "", onlyAdmin: true });
    expect(filterGroups(groups, parseGroupFilters({})).map((g) => g.name)).toEqual([
      "Promoções Relâmpago SP",
      "Achadinhos da Ana",
    ]);
  });

  it("todos=1 mostra também os grupos em que não é admin", () => {
    expect(filterGroups(groups, parseGroupFilters({ todos: "1" }))).toHaveLength(4);
  });

  it("busca ignora maiúsculas e acentos", () => {
    const filters = parseGroupFilters({ busca: "PROMOCOES relampago", todos: "1" });
    expect(filterGroups(groups, filters).map((g) => g.name)).toEqual(["Promoções Relâmpago SP"]);
    expect(filterGroups(groups, parseGroupFilters({ busca: "familia", todos: "1" })).map((g) => g.name)).toEqual([
      "Família",
    ]);
  });

  it("busca combina com o filtro de admin", () => {
    const filters = parseGroupFilters({ busca: "promo" });
    expect(filterGroups(groups, filters).map((g) => g.name)).toEqual(["Promoções Relâmpago SP"]);
  });

  it("busca vazia ou só espaços não filtra; texto longo é cortado", () => {
    expect(filterGroups(groups, parseGroupFilters({ busca: "   ", todos: "1" }))).toHaveLength(4);
    expect(parseGroupFilters({ busca: "x".repeat(500) }).search).toHaveLength(100);
    expect(normalizeForSearch("  Ação  ")).toBe("acao");
  });
});
