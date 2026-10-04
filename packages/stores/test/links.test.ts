import { describe, expect, it } from "vitest";
import {
  amazonAffiliateUrl,
  AffiliateLinkError,
  extractProductInfo,
  fetchProductInfo,
  generateAffiliateLink,
  isMercadoLivreShortLink,
  isMercadoLivreSocialPage,
  isOwnMercadoLivreLink,
  mercadoLivreTagsOf,
  readMercadoLivreSocialPage,
  resolveMercadoLivreShortLink,
  mercadoLivreAffiliateUrl,
  MissingCredentialError,
  parseProductUrl,
  priceToCents,
  readMercadoLivreAffiliateLink,
  readSheinAffiliateId,
  resolveStoreUrl,
  SHEIN_CAMPAIGN_ID,
  sheinAffiliateUrl,
  storeOfHost,
} from "../src";
import { fakeFetch, html, redirect } from "./helpers";

const u = (s: string) => new URL(s);

describe("identificação da loja e do produto pela URL", () => {
  it("domínios e encurtadores de cada loja", () => {
    expect(storeOfHost("shopee.com.br")).toBe("SHOPEE");
    expect(storeOfHost("s.shopee.com.br")).toBe("SHOPEE");
    expect(storeOfHost("meli.la")).toBe("MERCADO_LIVRE");
    expect(storeOfHost("produto.mercadolivre.com.br")).toBe("MERCADO_LIVRE");
    expect(storeOfHost("amzn.to")).toBe("AMAZON");
    expect(storeOfHost("onelink.shein.com")).toBe("SHEIN");
    expect(storeOfHost("evilshopee.com.br")).toBeNull();
    expect(storeOfHost("shopee.com.br.golpe.com")).toBeNull();
  });

  it("Shopee: /product/loja/item e -i.loja.item viram a mesma URL limpa", () => {
    const expected = { store: "SHOPEE", externalId: "222", productUrl: "https://shopee.com.br/product/111/222" };
    expect(parseProductUrl(u("https://shopee.com.br/product/111/222?sp_atk=x"))).toEqual(expected);
    expect(parseProductUrl(u("https://shopee.com.br/Fone-Bluetooth-i.111.222?xptdk=y"))).toEqual(expected);
  });

  it("Amazon: /dp/, /gp/product/ e com tag de outro afiliado", () => {
    expect(parseProductUrl(u("https://www.amazon.com.br/Echo-Dot/dp/B09B8V1LZ3/ref=sr_1_1?tag=outro-20"))).toEqual({
      store: "AMAZON",
      externalId: "B09B8V1LZ3",
      productUrl: "https://www.amazon.com.br/dp/B09B8V1LZ3",
    });
    expect(parseProductUrl(u("https://www.amazon.com.br/gp/product/b09b8v1lz3"))?.externalId).toBe("B09B8V1LZ3");
  });

  it("Mercado Livre: anúncio e página de produto; tira parâmetros", () => {
    expect(parseProductUrl(u("https://produto.mercadolivre.com.br/MLB-1234567890-air-fryer-_JM?matt_word=outro#x"))).toEqual({
      store: "MERCADO_LIVRE",
      externalId: "MLB1234567890",
      productUrl: "https://produto.mercadolivre.com.br/MLB-1234567890-air-fryer-_JM",
    });
    expect(parseProductUrl(u("https://www.mercadolivre.com.br/air-fryer/p/MLB19876543"))?.externalId).toBe("MLB19876543");
  });

  it("Shein: br.shein.com e m.shein.com/br viram br.shein.com", () => {
    const expected = {
      store: "SHEIN",
      externalId: "1234567",
      productUrl: "https://br.shein.com/Vestido-Floral-p-1234567.html",
    };
    expect(parseProductUrl(u("https://br.shein.com/Vestido-Floral-p-1234567.html?src_identifier=x"))).toEqual(expected);
    expect(parseProductUrl(u("https://m.shein.com/br/Vestido-Floral-p-1234567.html"))).toEqual(expected);
  });

  it("URL de loja que não é produto: null", () => {
    expect(parseProductUrl(u("https://shopee.com.br/"))).toBeNull();
    expect(parseProductUrl(u("https://www.amazon.com.br/s?k=fone"))).toBeNull();
  });
});

describe("redirecionamentos (só dentro das lojas)", () => {
  it("segue meli.la até a página do produto", async () => {
    const { fetch } = fakeFetch({
      "https://meli.la/2Abc": () => redirect("https://mercadolivre.com/sec/1xyz"),
      "https://mercadolivre.com/sec/1xyz": () =>
        redirect("https://produto.mercadolivre.com.br/MLB-111222333-x?matt_word=cliente&matt_tool=123"),
      "https://produto.mercadolivre.com.br/MLB-111222333-x?matt_word=cliente&matt_tool=123": () => html("<html></html>"),
    });
    const chain = await resolveStoreUrl("https://meli.la/2Abc", { fetch });
    expect(chain.map((x) => x.hostname)).toEqual(["meli.la", "mercadolivre.com", "produto.mercadolivre.com.br"]);
  });

  it("segue meta refresh (página intermediária)", async () => {
    const { fetch } = fakeFetch({
      "https://onelink.shein.com/9/abc": () =>
        html('<meta http-equiv="refresh" content="0;url=https://br.shein.com/x-p-55555.html?url_from=affiliate_koc_987654&amp;campaign_id=20">'),
      "https://br.shein.com/x-p-55555.html?url_from=affiliate_koc_987654&campaign_id=20": () => html("<html></html>"),
    });
    const chain = await resolveStoreUrl("https://onelink.shein.com/9/abc", { fetch });
    expect(chain.at(-1)?.searchParams.get("url_from")).toBe("affiliate_koc_987654");
  });

  it("bloqueia redirecionamento para fora das lojas e endereço que não é de loja", async () => {
    const { fetch, calls } = fakeFetch({ "https://meli.la/x": () => redirect("http://169.254.169.254/latest/meta-data") });
    await expect(resolveStoreUrl("https://meli.la/x", { fetch })).rejects.toThrow("não é de uma loja suportada");
    expect(calls.map((c) => c.url)).toEqual(["https://meli.la/x"]);
    await expect(resolveStoreUrl("https://localhost/admin", { fetch })).rejects.toThrow("não é de uma loja suportada");
    await expect(resolveStoreUrl("ftp://shopee.com.br/x", { fetch })).rejects.toThrow("https://");
  });
});

describe("credenciais do cliente a partir de link colado", () => {
  it("Mercado Livre: link completo (sem rede) e meli.la (seguindo o redirecionamento)", async () => {
    expect(
      await readMercadoLivreAffiliateLink("https://produto.mercadolivre.com.br/MLB-1-x?matt_word=minhaloja&matt_tool=45678901"),
    ).toEqual({ mattWord: "minhaloja", mattTool: "45678901" });

    const { fetch } = fakeFetch({
      "https://meli.la/2Abc": () => redirect("https://www.mercadolivre.com.br/p/MLB123456?matt_word=curta&matt_tool=111"),
      "https://www.mercadolivre.com.br/p/MLB123456?matt_word=curta&matt_tool=111": () => html("<html></html>"),
    });
    expect(await readMercadoLivreAffiliateLink("https://meli.la/2Abc", { fetch })).toEqual({ mattWord: "curta", mattTool: "111" });
  });

  it("Mercado Livre (caso real): meli.la -> /social/ com as etiquetas e página que se recarrega sem parar", async () => {
    const social = "https://www.mercadolivre.com.br/social/soly123?matt_word=minhaloja&matt_tool=45678901&forceInApp=true&ref=x";
    const { fetch, calls } = fakeFetch({
      "https://meli.la/Ex4mpl0": () => redirect(social, 301),
      // A página manda recarregar para ela mesma (com parâmetro novo) para sempre.
      [social]: () => html('<meta http-equiv="refresh" content="0;url=https://www.mercadolivre.com.br/social/soly123?t=1">'),
      "https://www.mercadolivre.com.br/social/soly123?t=1": () =>
        html('<meta http-equiv="refresh" content="0;url=https://www.mercadolivre.com.br/social/soly123?t=2">'),
    });
    expect(await readMercadoLivreAffiliateLink("https://meli.la/Ex4mpl0", { fetch })).toEqual({
      mattWord: "minhaloja",
      mattTool: "45678901",
    });
    // Parou ao ver as etiquetas: nem abriu a página /social/.
    expect(calls.map((c) => c.url)).toEqual(["https://meli.la/Ex4mpl0"]);
  });

  it("página normal de loja não tem meta refresh seguido; redirecionamento em círculo para sem erro", async () => {
    const product = "https://produto.mercadolivre.com.br/MLB-123456789-x";
    const refreshing = fakeFetch({
      [product]: () => html(`<meta http-equiv="refresh" content="0;url=${product}?again=1">`),
    });
    expect((await resolveStoreUrl(product, { fetch: refreshing.fetch })).map(String)).toEqual([product]);

    const loop = fakeFetch({
      "https://meli.la/a": () => redirect("https://meli.la/b"),
      "https://meli.la/b": () => redirect("https://meli.la/a"),
    });
    expect((await resolveStoreUrl("https://meli.la/a", { fetch: loop.fetch })).map(String)).toEqual([
      "https://meli.la/a",
      "https://meli.la/b",
    ]);
  });

  it("Divulgar link: para ao chegar na página do produto (stopWhen)", async () => {
    const productUrl = "https://produto.mercadolivre.com.br/MLB-987654321-air-fryer";
    const { fetch, calls } = fakeFetch({ "https://meli.la/xyz": () => redirect(productUrl) });
    const chain = await resolveStoreUrl("https://meli.la/xyz", { fetch, stopWhen: (u) => parseProductUrl(u) !== null });
    expect(parseProductUrl(chain.at(-1)!)?.externalId).toBe("MLB987654321");
    expect(calls).toHaveLength(1);
  });

  it("Mercado Livre: link sem etiqueta ou de outra loja dá erro em pt-BR", async () => {
    const { fetch } = fakeFetch({ "https://produto.mercadolivre.com.br/MLB-1-x": () => html("<html></html>") });
    await expect(readMercadoLivreAffiliateLink("https://produto.mercadolivre.com.br/MLB-1-x", { fetch })).rejects.toThrow(
      "Não encontrei a Etiqueta",
    );
    await expect(readMercadoLivreAffiliateLink("https://shopee.com.br/x")).rejects.toThrow("Cole um link de afiliado do Mercado Livre");
  });

  it("Shein: ID digitado, link br.shein.com e onelink", async () => {
    expect(await readSheinAffiliateId(" 1090836954 ")).toEqual({ affiliateId: "1090836954" });
    expect(await readSheinAffiliateId("https://br.shein.com/x-p-1.html?url_from=affiliate_koc_1234567&campaign_id=20")).toEqual({
      affiliateId: "1234567",
    });
    const { fetch } = fakeFetch({
      "https://onelink.shein.com/3/xyz": () => redirect("https://m.shein.com/br/campaigns/x?url_from=affiliate_koc_7654321&campaign_id=20"),
      "https://m.shein.com/br/campaigns/x?url_from=affiliate_koc_7654321&campaign_id=20": () => html("<html></html>"),
    });
    expect(await readSheinAffiliateId("https://onelink.shein.com/3/xyz", { fetch })).toEqual({ affiliateId: "7654321" });
    await expect(readSheinAffiliateId("abc")).rejects.toThrow("Shein");
  });
});

describe("Mercado Livre: meli.la do portal (página social com ref)", () => {
  const SHORT = "https://meli.la/Ex4mpl0";
  const SOCIAL =
    "https://www.mercadolivre.com.br/social/soly123?matt_word=minhaloja&matt_tool=45678901&forceInApp=true&ref=TOKEN200";
  const SOCIAL_HTML = `<head>
    <meta property="og:title" content="Principia, Sérum Facial Retinol, 30ml">
    <meta property="og:image" content="https://http2.mlstatic.com/D_NQ_serum.jpg">
    <meta property="og:url" content="https://www.mercadolivre.com.br/social/soly123">
  </head><body>
    <a href="https://www.mercadolivre.com.br/c/livros-revistas-e-comics">Livros</a>
    <a href="https://www.mercadolivre.com.br/principia-serum-facial-retinol-30ml/p/MLB19132085?pdp_filters=x&amp;matt_tracing_id=abc">Ver</a>
    <script type="application/ld+json">{"@type":"Product","name":"Principia, Sérum Facial Retinol, 30ml","offers":{"price":"69.90"}}</script>
  </body>`;

  it("resolve o meli.la parando na página social que já tem as etiquetas", async () => {
    const { fetch, calls } = fakeFetch({ [SHORT]: () => redirect(SOCIAL, 301) });
    const { tags, landing } = await resolveMercadoLivreShortLink(SHORT, { fetch });
    expect(tags).toEqual({ mattWord: "minhaloja", mattTool: "45678901" });
    expect(landing.pathname).toBe("/social/soly123");
    expect(calls).toHaveLength(1);
  });

  it("é do cliente só se Etiqueta E ID da Ferramenta baterem", () => {
    const tags = mercadoLivreTagsOf(new URL(SOCIAL));
    expect(isOwnMercadoLivreLink(tags, { mattWord: "minhaloja", mattTool: "45678901" })).toBe(true);
    expect(isOwnMercadoLivreLink(tags, { mattWord: "minhaloja", mattTool: "999" })).toBe(false);
    expect(isOwnMercadoLivreLink(tags, { mattWord: "outra", mattTool: "45678901" })).toBe(false);
    expect(isOwnMercadoLivreLink(tags, null)).toBe(false);
    expect(isOwnMercadoLivreLink(null, { mattWord: "minhaloja", mattTool: "45678901" })).toBe(false);
  });

  it("lê título, preço e imagem da página social e acha o produto recomendado", async () => {
    const { fetch } = fakeFetch({ [SOCIAL]: () => html(SOCIAL_HTML) });
    const { info, product } = await readMercadoLivreSocialPage(new URL(SOCIAL), { fetch });
    expect(info).toMatchObject({
      title: "Principia, Sérum Facial Retinol, 30ml",
      imageUrl: "https://http2.mlstatic.com/D_NQ_serum.jpg",
      priceCents: 6990,
    });
    expect(product).toEqual({
      store: "MERCADO_LIVRE",
      externalId: "MLB19132085",
      productUrl: "https://www.mercadolivre.com.br/principia-serum-facial-retinol-30ml/p/MLB19132085",
    });
    expect(isMercadoLivreShortLink(new URL(SHORT))).toBe(true);
    expect(isMercadoLivreSocialPage(new URL(SOCIAL))).toBe(true);
  });

  it("link de outra pessoa: o produto achado é convertido com as etiquetas DO CLIENTE (troca, não soma)", async () => {
    const { fetch } = fakeFetch({ [SOCIAL]: () => html(SOCIAL_HTML) });
    const { product } = await readMercadoLivreSocialPage(new URL(SOCIAL), { fetch });
    const link = await generateAffiliateLink("t1", product!, { getSecrets: async () => ({ mattWord: "cliente", mattTool: "111" }) });
    const url = new URL(link);
    expect(url.searchParams.get("matt_word")).toBe("cliente");
    expect(url.searchParams.get("matt_tool")).toBe("111");
    expect(link).not.toContain("minhaloja");
  });
});

describe("links de afiliado (Amazon, Mercado Livre, Shein)", () => {
  it("Amazon: /dp/ASIN?tag=cliente", () => {
    expect(amazonAffiliateUrl("B09B8V1LZ3", "minhaloja-20")).toBe("https://www.amazon.com.br/dp/B09B8V1LZ3?tag=minhaloja-20");
  });

  it("Mercado Livre: troca a etiqueta de outro afiliado pela do cliente (não soma)", () => {
    const link = mercadoLivreAffiliateUrl(
      "https://produto.mercadolivre.com.br/MLB-1-x?matt_word=outro&matt_tool=9&foo=1",
      "minhaloja",
      "45678",
    );
    const url = new URL(link);
    expect(url.searchParams.getAll("matt_word")).toEqual(["minhaloja"]);
    expect(url.searchParams.get("matt_tool")).toBe("45678");
    expect(url.searchParams.get("foo")).toBe("1");
  });

  it("Shein: url_from=affiliate_koc_{ID} e campaign_id=20", () => {
    expect(SHEIN_CAMPAIGN_ID).toBe("20");
    expect(sheinAffiliateUrl("https://br.shein.com/Vestido-p-1234567.html?url_from=affiliate_koc_999&campaign_id=10", "1090836954")).toBe(
      "https://br.shein.com/Vestido-p-1234567.html?url_from=affiliate_koc_1090836954&campaign_id=20",
    );
  });

  it("generateAffiliateLink: cada loja usa a credencial do tenant; sem credencial = erro com a loja", async () => {
    const secrets: Record<string, Record<string, string>> = {
      AMAZON: { tag: "loja-20" },
      MERCADO_LIVRE: { mattWord: "loja", mattTool: "123" },
      SHEIN: { affiliateId: "55555" },
    };
    const getSecrets = async (store: string) => secrets[store] ?? null;
    expect(
      await generateAffiliateLink("t1", { store: "AMAZON", externalId: "B000000001", productUrl: "https://www.amazon.com.br/dp/B000000001" }, { getSecrets }),
    ).toBe("https://www.amazon.com.br/dp/B000000001?tag=loja-20");
    expect(
      await generateAffiliateLink("t1", { store: "MERCADO_LIVRE", externalId: "MLB1", productUrl: "https://produto.mercadolivre.com.br/MLB-1-x" }, { getSecrets }),
    ).toBe("https://produto.mercadolivre.com.br/MLB-1-x?matt_word=loja&matt_tool=123");
    expect(
      await generateAffiliateLink("t1", { store: "SHEIN", externalId: "1", productUrl: "https://br.shein.com/x-p-1.html" }, { getSecrets }),
    ).toBe("https://br.shein.com/x-p-1.html?url_from=affiliate_koc_55555&campaign_id=20");

    const missing = await generateAffiliateLink(
      "t1",
      { store: "MERCADO_LIVRE", externalId: "MLB1", productUrl: "https://produto.mercadolivre.com.br/MLB-1-x" },
      { getSecrets: async () => null },
    ).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(MissingCredentialError);
    expect((missing as Error).message).toBe("Configure sua credencial da Mercado Livre para gerar links desta loja.");

    await expect(
      generateAffiliateLink("t1", { store: "MAGALU", externalId: "1", productUrl: "https://www.magazineluiza.com.br/x" }, { getSecrets }),
    ).rejects.toBeInstanceOf(AffiliateLinkError);
  });
});

describe("leitura da página do produto", () => {
  it("Open Graph e meta de preço", () => {
    const page = `<head>
      <meta property="og:title" content="Air Fryer Mondial 4L &amp; Cesto">
      <meta content="https://http2.mlstatic.com/D_NQ_x.jpg" property="og:image">
      <meta property="product:price:amount" content="299.90">
    </head>`;
    expect(extractProductInfo(page)).toEqual({
      title: "Air Fryer Mondial 4L & Cesto",
      imageUrl: "https://http2.mlstatic.com/D_NQ_x.jpg",
      priceCents: 29990,
      originalPriceCents: null,
    });
  });

  it("JSON-LD de produto tem prioridade", () => {
    const page = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Vestido Floral",
      "image":["https://img.ltwebstatic.com/v.jpg"],"offers":{"@type":"Offer","price":"89.99"}}</script>
      <meta property="og:title" content="SHEIN | outro título">`;
    expect(extractProductInfo(page)).toMatchObject({ title: "Vestido Floral", imageUrl: "https://img.ltwebstatic.com/v.jpg", priceCents: 8999 });
  });

  it("preço em formato brasileiro e americano", () => {
    expect(priceToCents("R$ 1.299,90")).toBe(129990);
    expect(priceToCents("1299.90")).toBe(129990);
    expect(priceToCents(59.9)).toBe(5990);
    expect(priceToCents("grátis")).toBeNull();
  });

  it("fetchProductInfo: só baixa de domínio de loja; página bloqueada = null (cliente preenche)", async () => {
    const { fetch, calls } = fakeFetch({
      "https://www.amazon.com.br/dp/B000000001": () => new Response("captcha", { status: 503 }),
    });
    expect(await fetchProductInfo("https://www.amazon.com.br/dp/B000000001", { fetch })).toBeNull();
    expect(await fetchProductInfo("https://169.254.169.254/x", { fetch })).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
