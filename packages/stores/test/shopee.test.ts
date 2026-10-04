import { createHash } from "node:crypto";
import type { MinedProduct } from "@achadinhos/db";
import { describe, expect, it, vi } from "vitest";
import {
  generateAffiliateLink,
  parseProductOffers,
  productOfferQuery,
  sanitizeSubId,
  SHOPEE_GRAPHQL_URL,
  ShopeeCatalogReader,
  ShopeeLinkGenerator,
  shopeeErrorMessage,
  shopeeSignature,
  toMinedProduct,
} from "../src";
import { ShopeeApiError } from "../src/shopee/client";
import { graphqlOffers, json, shopeeNode } from "./helpers";

type FetchCall = [string | URL | Request, RequestInit | undefined];

describe("Shopee: assinatura e requisição", () => {
  it("assinatura = SHA256(AppId + Timestamp + Payload + Secret) e cabeçalho no formato da Shopee", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => graphqlOffers([]));
    const reader = new ShopeeCatalogReader({
      appId: "123456",
      secret: "segredo",
      fetch: fetchMock as unknown as typeof fetch,
      now: () => 1_700_000_000,
    });
    await reader.searchOffers({ page: 1, limit: 1 }, "OTHER");

    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    const body = String(init?.body);
    const expected = createHash("sha256").update(`1234561700000000${body}segredo`).digest("hex");
    expect(url).toBe(SHOPEE_GRAPHQL_URL);
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `SHA256 Credential=123456, Timestamp=1700000000, Signature=${expected}`,
    );
    expect(shopeeSignature("123456", 1_700_000_000, body, "segredo")).toBe(expected);
  });

  it("erro GraphQL vira exceção com a mensagem da Shopee (e mensagem pt-BR para o cliente)", async () => {
    const reader = new ShopeeCatalogReader({
      appId: "1",
      secret: "s",
      fetch: (async () => json({ errors: [{ message: "Invalid Signature", extensions: { code: 10020 } }] })) as typeof fetch,
    });
    const error = await reader.getProduct("1").catch((e: unknown) => e);
    expect(error).toMatchObject({ message: "Invalid Signature", code: 10020 });
    expect(shopeeErrorMessage(error)).toBe("A Shopee recusou o AppID ou a Senha da API. Confira os dados no portal de afiliados.");
    expect(shopeeErrorMessage(new ShopeeApiError("Rate limit"))).toBe("A Shopee respondeu: Rate limit");
  });

  it("consulta: palavra-chave escapada, itemId só numérico e SEM pedir offerLink", () => {
    const q = productOfferQuery({ keyword: 'fone "bluetooth"', sortType: 2, page: 1, limit: 50 });
    expect(q).toContain('keyword: "fone \\"bluetooth\\""');
    expect(q).not.toContain("offerLink");
    expect(productOfferQuery({ itemId: "987", page: 1, limit: 1 })).toContain("itemId: 987");
    expect(() => productOfferQuery({ itemId: "1) { x }", page: 1, limit: 1 })).toThrow();
  });
});

describe("Shopee: conversão da resposta", () => {
  it("converte texto em centavos e %, calcula preço original e usa só o link limpo", () => {
    expect(toMinedProduct(shopeeNode(42), "ELECTRONICS")).toEqual<MinedProduct>({
      store: "SHOPEE",
      externalId: "42",
      title: "Fone Bluetooth 42",
      imageUrl: "https://cf.shopee.com.br/file/42",
      productUrl: "https://shopee.com.br/product/111/42",
      category: "ELECTRONICS",
      priceCents: 5990,
      originalPriceCents: 9983,
      discountPct: 40,
      commissionPct: 8,
      commissionCents: 479,
      rating: 4.8,
      soldCount: 12500,
    });
  });

  it("sem nota, sem desconto e comissão só em %: campos coerentes", () => {
    const p = toMinedProduct(shopeeNode(7, { ratingStar: "0", priceDiscountRate: 0, commission: null }), "PETS");
    expect(p).toMatchObject({ rating: null, discountPct: null, originalPriceCents: null, commissionCents: 479 });
  });

  it("descarta item incompleto e nunca carrega o link de afiliado da conta central", () => {
    expect(toMinedProduct(shopeeNode(1, { priceMin: "", priceMax: "0" }), "PETS")).toBeNull();
    expect(toMinedProduct(shopeeNode(3, { productLink: "nao-e-link" }), "PETS")).toBeNull();
    const list = parseProductOffers({ productOfferV2: { nodes: [shopeeNode(10), shopeeNode(11, { priceMin: null, priceMax: null })] } }, "PETS");
    expect(list.map((p) => p.externalId)).toEqual(["10"]);
    expect(JSON.stringify(list)).not.toContain("s.shopee.com.br");
  });

  it("getProduct: devolve o item pelo id, ou null se a Shopee não devolver", async () => {
    const found = new ShopeeCatalogReader({ appId: "1", secret: "s", fetch: (async () => graphqlOffers([shopeeNode(5)])) as typeof fetch });
    expect((await found.getProduct("5"))?.title).toBe("Fone Bluetooth 5");
    const empty = new ShopeeCatalogReader({ appId: "1", secret: "s", fetch: (async () => graphqlOffers([])) as typeof fetch });
    expect(await empty.getProduct("5")).toBeNull();
  });
});

describe("Shopee: link de afiliado (credencial do cliente)", () => {
  it("generateShortLink com originUrl e subIds (só letras e números, até 5)", async () => {
    const fetchMock = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) =>
      json({ data: { generateShortLink: { shortLink: "https://s.shopee.com.br/CLIENTE1" } } }),
    );
    const generator = new ShopeeLinkGenerator({ appId: "99999999999", secret: "do-cliente", fetch: fetchMock as unknown as typeof fetch });
    const link = await generator.generateShortLink("https://shopee.com.br/product/1/2", ["tenant_abc-1", "g:2", "a", "b", "c", "d"]);
    expect(link).toBe("https://s.shopee.com.br/CLIENTE1");
    const { query } = JSON.parse(String((fetchMock.mock.calls[0] as FetchCall)[1]?.body)) as { query: string };
    expect(query).toBe(
      'mutation { generateShortLink(input: { originUrl: "https://shopee.com.br/product/1/2", subIds: ["tenantabc1","g2","a","b","c"] }) { shortLink } }',
    );
    expect(sanitizeSubId("x".repeat(80))).toHaveLength(50);
  });

  it("Testar: sucesso não lança; recusa da Shopee lança", async () => {
    const ok = new ShopeeLinkGenerator({
      appId: "1",
      secret: "s",
      fetch: (async () => json({ data: { generateShortLink: { shortLink: "https://s.shopee.com.br/x" } } })) as typeof fetch,
    });
    await expect(ok.test()).resolves.toBeUndefined();
    const bad = new ShopeeLinkGenerator({
      appId: "1",
      secret: "s",
      fetch: (async () => json({ errors: [{ message: "Invalid Signature", extensions: { code: 10020 } }] })) as typeof fetch,
    });
    await expect(bad.test()).rejects.toBeInstanceOf(ShopeeApiError);
  });
});

describe("REGRA: credencial central só lê; link sempre com a credencial do cliente", () => {
  it("o leitor (credencial central) não tem operação de link e só envia consultas de leitura", async () => {
    const bodies: string[] = [];
    const reader = new ShopeeCatalogReader({
      appId: "CENTRAL",
      secret: "segredo-central",
      fetch: (async (_u: string | URL | Request, init?: RequestInit) => {
        bodies.push(String(init?.body));
        return graphqlOffers([shopeeNode(1)]);
      }) as typeof fetch,
    });
    expect("generateShortLink" in reader).toBe(false);
    expect(Object.getOwnPropertyNames(ShopeeCatalogReader.prototype)).not.toContain("generateShortLink");
    await reader.getProduct("1");
    await reader.searchOffers({ keyword: "fone", page: 1, limit: 10 }, "ELECTRONICS");
    expect(bodies.every((b) => b.includes("productOfferV2") && !b.includes("generateShortLink") && !b.includes("mutation"))).toBe(true);
  });

  it("generateAffiliateLink usa SÓ a credencial do tenant (nunca a central), com o tenant como subId", async () => {
    process.env.SHOPEE_CATALOG_APP_ID = "11111111111"; // credencial central presente no ambiente
    process.env.SHOPEE_CATALOG_SECRET = "segredo-central";
    const auth: string[] = [];
    const queries: string[] = [];
    const fetchMock = (async (_u: string | URL | Request, init?: RequestInit) => {
      auth.push((init?.headers as Record<string, string>).Authorization ?? "");
      queries.push((JSON.parse(String(init?.body)) as { query: string }).query);
      return json({ data: { generateShortLink: { shortLink: "https://s.shopee.com.br/DOCLIENTE" } } });
    }) as typeof fetch;
    const getSecrets = vi.fn(async () => ({ appId: "22222222222", apiSecret: "segredo-do-cliente" }));

    const link = await generateAffiliateLink(
      "tenantA",
      { store: "SHOPEE", externalId: "2", productUrl: "https://shopee.com.br/product/1/2" },
      { getSecrets, fetch: fetchMock },
    );
    expect(link).toBe("https://s.shopee.com.br/DOCLIENTE");
    expect(getSecrets).toHaveBeenCalledWith("SHOPEE");
    expect(auth).toHaveLength(1);
    expect(auth[0]).toContain("Credential=22222222222");
    expect(auth.join()).not.toContain("11111111111");
    expect(queries[0]).toContain('subIds: ["tenantA"]');
    delete process.env.SHOPEE_CATALOG_APP_ID;
    delete process.env.SHOPEE_CATALOG_SECRET;
  });

  it("sem credencial do tenant: erro claro, sem cair para a credencial central", async () => {
    process.env.SHOPEE_CATALOG_APP_ID = "11111111111";
    process.env.SHOPEE_CATALOG_SECRET = "segredo-central";
    const fetchMock = vi.fn();
    await expect(
      generateAffiliateLink(
        "tenantA",
        { store: "SHOPEE", externalId: "2", productUrl: "https://shopee.com.br/product/1/2" },
        { getSecrets: async () => null, fetch: fetchMock as unknown as typeof fetch },
      ),
    ).rejects.toThrow("Configure sua credencial da Shopee para gerar links desta loja.");
    expect(fetchMock).not.toHaveBeenCalled();
    delete process.env.SHOPEE_CATALOG_APP_ID;
    delete process.env.SHOPEE_CATALOG_SECRET;
  });
});
