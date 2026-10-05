import { afterEach, describe, expect, it } from "vitest";
import { handleRequest, resetCsrfCache } from "../src/handlers";
import { AFFILIATE_HUB_URL } from "../src/ml";
import { HUB_SEARCH_URL, hubSearchBody, parseHubSearch, parseSoldCount, toHubItem } from "../src/ml-hub";
import type { ExtensionResult } from "../src/protocol";

// Cards no formato REAL da vitrine do portal (resposta capturada, resumida).
const review = (rating: string, sold: string) => ({
  type: "review_compacted",
  id: "review_compacted",
  review_compacted: {
    text: "{icon_star_fill} {label} {label2}",
    values: [
      { key: "icon_star_fill", type: "icon" },
      { key: "label", type: "label", label: { text: rating } },
      { key: "label2", type: "label", label: { text: `| ${sold}` } },
    ],
  },
});
const chip = (text: string) => ({ type: "chip", id: "affiliates_commission_chip", chip: { pill: { text } } });
const price = (current: number, previous?: number, discount?: string) => ({
  type: "price",
  id: "price",
  price: {
    ...(previous ? { previous_price: { value: previous, currency: "BRL" } } : {}),
    current_price: { value: current, currency: "BRL" },
    ...(discount ? { discount_label: { text: discount } } : {}),
  },
});

const CHALEIRA = {
  unique_id: "p64",
  metadata: {
    id: "MLB6676342192",
    url: "www.mercadolivre.com.br/chaleira-eletrica-inox-jarra-18-litros-prateado/up/MLBU3920036187",
    url_params: "?pdp_filters=deal%3AMLB1578289-1&extra_comm=false",
    extra_commission: "false",
  },
  pictures: { pictures: [{ id: "913877-MLB110039095980_042026" }] },
  components: [
    { type: "title", id: "title", title: { text: "Chaleira Elétrica Inox Jarra 1,8 Litros Prateado 127v 1200w" } },
    review("4.7", "+10mil vendidos"),
    chip("GANHOS 5%"),
    price(36, 39.9, "9% OFF no Pix"),
    { type: "action_links", id: "action_links" },
  ],
};

const ARMARIO = {
  metadata: {
    id: "MLB4533286571",
    url: "www.mercadolivre.com.br/armario-de-cozinha-poliman-moveis-clarice-12-portas-1-gaveta/p/MLB62724058",
    extra_commission: "false",
  },
  pictures: { pictures: [{ id: "813982-MLA100082279019_122025" }] },
  components: [
    { type: "highlight", id: "highlight", highlight: { text: "MAIS VENDIDO" } },
    { type: "title", id: "title", title: { text: "Armário de Cozinha Poliman Móveis Clarice 12 Portas 1 Gaveta" } },
    review("4.7", "+1000 vendidos"),
    chip("GANHOS 12%"),
    price(649.99, 949.95, "31% OFF"),
  ],
};

const PANELA_EXTRA = {
  metadata: {
    id: "MLB4590121239",
    url: "www.mercadolivre.com.br/jogo-panela-ceramica-antiaderente-5pc-tampa-silicone-inducao/up/MLBU3892648456",
    extra_commission: "true",
  },
  pictures: { pictures: [{ id: "815631-MLB109277052486_042026" }] },
  components: [
    { type: "highlight", id: "highlight", highlight: { text: "{black_friday_icon} OFERTA IMPERDÍVEL" } },
    { type: "title", id: "title", title: { text: "Jogo Panela Ceramica Antiaderente 5pç Tampa Silicone Induçao Bege" } },
    review("4.8", "+1000 vendidos"),
    {
      type: "chip",
      id: "affiliates_commission_chip",
      chip: {
        pill: {
          text: "{ganancia} {extra}",
          values: [
            { key: "ganancia", type: "label", label: { text: "GANHOS 10%" } },
            { key: "extra", type: "label", label: { text: "+ EXTRA" } },
          ],
        },
      },
    },
    price(89.9),
  ],
};

const ALCOOL_SEM_DE = {
  metadata: {
    id: "MLB4067001915",
    url: "www.mercadolivre.com.br/alcool-isopropilico-quimivida-5-litros-puro-limpador-eletronico-antiestatico/p/MLB39324972",
  },
  pictures: { pictures: [{ id: "677790-MLA99508085322_112025" }] },
  components: [
    { type: "title", id: "title", title: { text: "Álcool Isopropílico Quimivida 5 Litros Puro" } },
    review("4.8", "+10mil vendidos"),
    chip("GANHOS 5%"),
    price(78.66),
  ],
};

const RESPONSE = { polycard_client_model: { polycard_context: { type: "grid-card" }, polycards: [CHALEIRA, ARMARIO, PANELA_EXTRA, ALCOOL_SEM_DE] } };

describe("vitrine do Mercado Livre: conversão dos cards", () => {
  it("chaleira: preço, de, desconto, comissão, nota, vendidos, foto e endereço limpo", () => {
    expect(toHubItem(CHALEIRA)).toEqual({
      id: "MLB6676342192",
      productUrl: "https://www.mercadolivre.com.br/chaleira-eletrica-inox-jarra-18-litros-prateado/up/MLBU3920036187",
      title: "Chaleira Elétrica Inox Jarra 1,8 Litros Prateado 127v 1200w",
      imageUrl: "https://http2.mlstatic.com/D_Q_NP_2X_913877-MLB110039095980_042026-AB.webp",
      priceCents: 3600,
      originalPriceCents: 3990,
      discountLabel: "9% OFF no Pix",
      commissionPct: 5,
      extraCommission: false,
      rating: 4.7,
      soldText: "+10mil vendidos",
      soldCount: 10000,
      highlight: null,
    });
  });

  it("selo 'MAIS VENDIDO', comissão de 12% e '+1000 vendidos'", () => {
    expect(toHubItem(ARMARIO)).toMatchObject({ highlight: "MAIS VENDIDO", commissionPct: 12, soldCount: 1000, priceCents: 64999 });
  });

  it("comissão composta com ganhos extras; selo sem o ícone", () => {
    expect(toHubItem(PANELA_EXTRA)).toMatchObject({ commissionPct: 10, extraCommission: true, highlight: "OFERTA IMPERDÍVEL" });
  });

  it("'GANHOS EXTRAS 8%' em formatos diferentes do selo", () => {
    const withChip = (c: unknown) => ({ ...ALCOOL_SEM_DE, components: [...ALCOOL_SEM_DE.components.filter((x) => x.id !== "affiliates_commission_chip"), c] });
    // valores com chave e texto aninhado
    const nested = {
      type: "chip",
      id: "affiliates_extra_commission_chip",
      chip: { pill: { text: "GANHOS {extras} {pct}", values: [{ key: "extras", text: { text: "EXTRAS" } }, { key: "pct", text: "8%" }] } },
    };
    expect(toHubItem(withChip(nested))).toMatchObject({ commissionPct: 8, extraCommission: true });
    // texto inteiro num valor só
    expect(toHubItem(withChip(chip("GANHOS EXTRAS 8%")))).toMatchObject({ commissionPct: 8, extraCommission: true });
    // formato desconhecido: acha o % em qualquer lugar do selo de comissão
    const unknown = { type: "badge", id: "affiliates_commission_badge", badge: { content: [{ label: "GANHOS EXTRAS" }, { label: "8,5%" }] } };
    expect(toHubItem(withChip(unknown))).toMatchObject({ commissionPct: 8.5, extraCommission: true });
  });

  it("sem preço 'de': originalPriceCents null", () => {
    expect(toHubItem(ALCOOL_SEM_DE)).toMatchObject({ priceCents: 7866, originalPriceCents: null, discountLabel: null });
  });

  it("descarta card sem título, sem preço ou com endereço fora do ML", () => {
    expect(toHubItem({ ...CHALEIRA, components: CHALEIRA.components.filter((c) => c.id !== "title") })).toBeNull();
    expect(toHubItem({ ...CHALEIRA, components: CHALEIRA.components.filter((c) => c.id !== "price") })).toBeNull();
    expect(toHubItem({ ...CHALEIRA, metadata: { id: "x", url: "evil.com/produto" } })).toBeNull();
    expect(parseHubSearch(RESPONSE)).toHaveLength(4);
    expect(() => parseHubSearch({ nada: true })).toThrow("formato inesperado");
  });

  it("quantidade vendida", () => {
    expect(parseSoldCount("+10mil vendidos")).toBe(10000);
    expect(parseSoldCount("+1000 vendidos")).toBe(1000);
    expect(parseSoldCount("+100 vendidos")).toBe(100);
    expect(parseSoldCount("+1,5mil vendidos")).toBe(1500);
  });
});

describe("vitrine do Mercado Livre: pedido", () => {
  afterEach(() => resetCsrfCache());

  it("monta o corpo igual ao portal (mais vendidos, categoria, busca e página)", () => {
    expect(hubSearchBody({ search: "", category: null, bestSeller: true, offset: 0 })).toEqual({
      search: "",
      sort: "relevance",
      filters: [{ id: "best_seller", value: true }],
      offset: 0,
    });
    expect(hubSearchBody({ search: "fone", category: "MLB1246", bestSeller: true, offset: 48 })).toEqual({
      search: "fone",
      sort: "relevance",
      filters: [
        { id: "category", value: "MLB1246" },
        { id: "best_seller", value: true },
      ],
      offset: 48,
    });
  });

  it("ml.hubSearch: token + POST na vitrine, devolve os cards convertidos", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, ...(init ? { init } : {}) });
      if (url === AFFILIATE_HUB_URL) {
        const r = new Response('<meta name="csrf-token" content="tok-123456789">', { status: 200 });
        Object.defineProperty(r, "url", { value: AFFILIATE_HUB_URL });
        return r;
      }
      if (url === HUB_SEARCH_URL) return new Response(JSON.stringify(RESPONSE), { status: 200 });
      throw new Error(`inesperado: ${url}`);
    }) as typeof fetch;

    const result = (await handleRequest(
      "ml.hubSearch",
      { search: "", category: "MLB1246", bestSeller: true, offset: 0 },
      { fetch: fetchMock },
    )) as ExtensionResult<"ml.hubSearch">;
    expect(result.ok && result.data.items.map((i) => i.id)).toEqual(["MLB6676342192", "MLB4533286571", "MLB4590121239", "MLB4067001915"]);
    const post = calls.find((c) => c.url === HUB_SEARCH_URL)!;
    expect((post.init?.headers as Record<string, string>)["x-csrf-token"]).toBe("tok-123456789");
    expect(JSON.parse(String(post.init?.body)).filters).toContainEqual({ id: "category", value: "MLB1246" });
  });

  it("categoria inválida é recusada antes de chamar o ML", async () => {
    const result = await handleRequest("ml.hubSearch", { category: "DROP TABLE" }, { fetch: (async () => new Response()) as unknown as typeof fetch });
    expect(result.ok).toBe(false);
  });
});
