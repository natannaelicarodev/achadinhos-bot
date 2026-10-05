import { describe, expect, it } from "vitest";
import { isFoodTitle, isSystemAdmin, isValidVitrineToken, vitrinePayloadSchema, vitrineToMinedProducts } from "@/lib/ml-vitrine";

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  productUrl: `https://www.mercadolivre.com.br/produto/up/${id}`,
  title: `Produto ${id}`,
  imageUrl: "https://http2.mlstatic.com/D_Q_NP_2X_1-AB.webp",
  priceCents: 8000,
  originalPriceCents: 10000,
  discountLabel: "20% OFF",
  commissionPct: 5,
  extraCommission: false,
  rating: 4.7,
  soldText: "+10mil vendidos",
  soldCount: 10000,
  highlight: null,
  ...extra,
});

describe("vitrine compartilhada do Mercado Livre", () => {
  it("converte para produto do catálogo: categoria pelo código do ML, desconto e comissão em R$", () => {
    const payload = vitrinePayloadSchema.parse({
      batches: [
        { mlCategory: "MLB1246", items: [item("MLB123456")] },
        { mlCategory: null, items: [item("MLB999999", { originalPriceCents: null, commissionPct: null })] },
      ],
    });
    const [beauty, other] = vitrineToMinedProducts(payload);
    expect(beauty).toMatchObject({
      store: "MERCADO_LIVRE",
      externalId: "MLB123456",
      category: "BEAUTY",
      discountPct: 20,
      commissionCents: 400,
      soldCount: 10000,
    });
    expect(other).toMatchObject({ category: "OTHER", originalPriceCents: null, discountPct: null, commissionCents: null });
  });

  it("busca por palavra fora da lista do painel fica sem categoria (a extensão não escolhe categoria)", () => {
    const payload = vitrinePayloadSchema.parse({
      batches: [{ mlCategory: null, search: "chocolate", items: [item("MLB500001", { title: "Chocolate Lacta 165g" })] }],
    });
    expect(vitrineToMinedProducts(payload).map((p) => p.category)).toEqual(["OTHER"]);
  });

  it("Alimentos: só título de comida/bebida (a busca do portal devolve qualquer coisa)", () => {
    for (const ok of [
      "Pirulito De Animais - Zoolito Caixa Com 30 Uni",
      "Café Em Grãos Pilão 1kg",
      "Whey Protein Concentrado Sabor Biscoitos 900g",
      "Bala De Goma Fini 500g",
      "Azeite Extra Virgem Gallo 500ml",
      "Kit 3 Chocolates Lindt 100g",
      "Caixa Com 50 Balas De Goma",
    ]) {
      expect(isFoodTitle(ok), ok).toBe(true);
    }
    for (const notFood of [
      "Café com Deus Pai Vol. 6 - 2026 - Editora Vélos - Capa Mole",
      "Top Puma Original Feminino Alta Sustentação",
      "Sacola Papel Kraft M 23x30x10cm 50und",
      "Hidratante Corporal Chocolate 400ml",
      "Cafeteira Elétrica Mondial 30 Xícaras",
      "Balança Digital De Cozinha 10kg",
      "Coador De Café Inox 103 Com Filtro Permanente",
      "Jogo 6 Taças Cristal De Vinho Tinto",
      "Kit Fondue Jogo De Panela Para Fondue 6 Pessoas Chocolate",
      "Esmalte Impala Cacau Show Nova Coleção Kit Com 5 Chocolates",
    ]) {
      expect(isFoodTitle(notFood), notFood).toBe(false);
    }
  });

  it("descarta item inválido ou fora do Mercado Livre sem derrubar a leva", () => {
    const payload = vitrinePayloadSchema.parse({
      batches: [
        {
          mlCategory: "MLB1071",
          items: [
            item("MLB111111", { productUrl: "https://evil.example.com/MLB111111" }),
            item("MLB222222", { imageUrl: "https://evil.example.com/x.png" }),
            item("nao-e-id"),
            item("MLBU333333"),
          ],
        },
      ],
    });
    expect(vitrineToMinedProducts(payload).map((p) => p.externalId)).toEqual(["MLBU333333"]);
  });

  it("chave da vitrine: exige Bearer igual ao .env; sem chave configurada fica desligado", () => {
    const key = "a".repeat(40);
    expect(isValidVitrineToken(`Bearer ${key}`, key)).toBe(true);
    expect(isValidVitrineToken(`Bearer ${"b".repeat(40)}`, key)).toBe(false);
    expect(isValidVitrineToken(null, key)).toBe(false);
    expect(isValidVitrineToken("Bearer x", undefined)).toBe(false);
    expect(isValidVitrineToken("Bearer curta", "curta")).toBe(false);
  });

  it("administrador do sistema vem do SYSTEM_ADMIN_EMAILS", () => {
    expect(isSystemAdmin("Dona@Exemplo.com", "outra@x.com, dona@exemplo.com")).toBe(true);
    expect(isSystemAdmin("cliente@x.com", "dona@exemplo.com")).toBe(false);
    expect(isSystemAdmin("dona@exemplo.com", "")).toBe(false);
  });
});
