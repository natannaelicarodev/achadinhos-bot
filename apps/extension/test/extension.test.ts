import { afterEach, describe, expect, it } from "vitest";
import { isPanelMessage } from "../src/constants";
import { handleRequest, resetCsrfCache } from "../src/handlers";
import {
  AFFILIATE_HUB_URL,
  cleanMlTitle,
  CREATE_LINK_URL,
  findCsrfToken,
  parseCreateLinkResponse,
  parsePreviousPrice,
} from "../src/ml";
import { EXTENSION_VERSION, isOutdated, PANEL_SOURCE, parseRequest, type ExtensionResult } from "../src/protocol";

// Resposta real do createLink (formato visto no portal, com dados fictícios).
const CREATE_LINK_BODY = {
  status: 200,
  urls: [
    {
      id: "Ex4mpl0",
      created: true,
      tag: "minhaloja",
      text: "🔎 Cole este texto no buscador do Mercado Livre: ABCD-1234",
      short_url: "https://meli.la/Ex4mpl0",
      long_url: "https://www.mercadolivre.com.br/social/minhaloja?matt_word=minhaloja&matt_tool=123&forceInApp=true&ref=TOKEN",
      type_url: "SOCIAL_PROFILE_ENCRYPTED",
      origin_url: "https://www.mercadolivre.com.br/chaleira/up/MLBU3920036187",
    },
  ],
  total_items: 1,
  total_success: 1,
  total_error: 0,
};

const PRODUCT = "https://www.mercadolivre.com.br/chaleira-eletrica/p/MLB123456789";
const HUB_HTML = `<html><head><meta name="csrf-token" content="tok-123456789"></head></html>`;
const PRODUCT_HTML = `<meta itemprop="price" content="417.57"><meta property="og:title" content="Controle DualSense">
  <meta property="og:image" content="https://http2.mlstatic.com/x.jpg">
  <s class="andes-money-amount andes-money-amount--previous"><span class="andes-money-amount__fraction">499</span><span class="andes-money-amount__cents">90</span></s>`;

type Call = { url: string; init?: RequestInit };

function fakeFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ...(init ? { init } : {}) });
    const handler = routes[url];
    if (!handler) throw new Error(`fetch inesperado: ${url}`);
    return handler(init);
  }) as typeof fetch;
  return { fetch: fn, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (body: string, url?: string) => {
  const r = new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  if (url) Object.defineProperty(r, "url", { value: url });
  return r;
};

afterEach(() => resetCsrfCache());

describe("protocolo", () => {
  it("só aceita endereço de produto do Mercado Livre e etiqueta válida", () => {
    expect(parseRequest("ml.createLink", { productUrl: PRODUCT, tag: "minhaloja" }).ok).toBe(true);
    expect(parseRequest("ml.createLink", { productUrl: "https://evil.com/x", tag: "a" })).toMatchObject({ ok: false });
    expect(parseRequest("ml.createLink", { productUrl: "http://www.mercadolivre.com.br/x", tag: "a" }).ok).toBe(false);
    expect(parseRequest("ml.createLink", { productUrl: PRODUCT, tag: "a b<script>" }).ok).toBe(false);
  });

  it("ponte: só repassa mensagens do painel no formato certo", () => {
    expect(isPanelMessage({ source: PANEL_SOURCE, id: "1", type: "ping", payload: {} })).toBe(true);
    expect(isPanelMessage({ source: "outro-site", id: "1", type: "ping" })).toBe(false);
    expect(isPanelMessage({ source: PANEL_SOURCE, id: "1", type: "roubarCookies" })).toBe(false);
    expect(isPanelMessage({ source: PANEL_SOURCE, id: "x".repeat(65), type: "ping" })).toBe(false);
    expect(isPanelMessage(null)).toBe(false);
  });

  it("versão desatualizada", () => {
    expect(isOutdated("0.0.9", "0.1.0")).toBe(true);
    expect(isOutdated("0.1.0", "0.1.0")).toBe(false);
    expect(isOutdated("1.0.0", "0.9.9")).toBe(false);
  });
});

describe("Mercado Livre (com respostas simuladas)", () => {
  it("lê o meli.la da resposta real do createLink", () => {
    expect(parseCreateLinkResponse(CREATE_LINK_BODY)).toEqual({
      shortUrl: "https://meli.la/Ex4mpl0",
      longUrl: CREATE_LINK_BODY.urls[0]!.long_url,
    });
    expect(() => parseCreateLinkResponse({ urls: [{ short_url: "https://evil.com/x" }] })).toThrow("meli.la");
    expect(() => parseCreateLinkResponse({ status: 500 })).toThrow();
  });

  it("acha o token de proteção no HTML (e diz em qual formato)", () => {
    expect(findCsrfToken(HUB_HTML)).toEqual({ token: "tok-123456789", pattern: "meta csrf-token" });
    expect(findCsrfToken(`window.__STATE__={"csrfToken":"abc123456789"}`)).toEqual({ token: "abc123456789", pattern: "json csrfToken" });
    expect(findCsrfToken("<html>nada</html>")).toBeNull();
  });

  it("preço 'de' (riscado) da página do ML", () => {
    expect(parsePreviousPrice(PRODUCT_HTML)).toBe(49990);
    expect(parsePreviousPrice("<html></html>")).toBeNull();
  });

  it("preço 'de' pela descrição de acessibilidade (markup real do ML com atributos longos)", () => {
    const real = `<s class="andes-money-amount andes-money-amount--previous andes-money-amount--cents-comma" role="img"
      aria-label="Antes: 499 reais com 90 centavos" itemprop="price">${" ".repeat(900)}
      <span class="andes-money-amount__fraction" aria-hidden="true">499</span></s>`;
    expect(parsePreviousPrice(real)).toBe(49990);
    expect(parsePreviousPrice(`<s class="andes-money-amount--previous" aria-label="Antes: 1.299 reais">`)).toBe(129900);
  });

  it("título sem o preço no final", () => {
    expect(cleanMlTitle("Controle Sony PlayStation 5 DualSense Midnight Black - R$ 449")).toBe(
      "Controle Sony PlayStation 5 DualSense Midnight Black",
    );
    expect(cleanMlTitle("Air Fryer 4L | Mercado Livre")).toBe("Air Fryer 4L");
    expect(cleanMlTitle("Kit 3 Camisetas")).toBe("Kit 3 Camisetas");
  });

  it("createLink: manda produto + etiqueta + token, com a sessão do navegador", async () => {
    const { fetch, calls } = fakeFetch({
      [AFFILIATE_HUB_URL]: () => html(HUB_HTML, AFFILIATE_HUB_URL),
      [CREATE_LINK_URL]: () => json(CREATE_LINK_BODY),
    });
    const result = await handleRequest("ml.createLink", { productUrl: PRODUCT, tag: "minhaloja" }, { fetch });
    expect(result).toEqual({ ok: true, data: { shortUrl: "https://meli.la/Ex4mpl0", longUrl: CREATE_LINK_BODY.urls[0]!.long_url } });
    const post = calls.find((c) => c.url === CREATE_LINK_URL)!;
    expect(post.init?.method).toBe("POST");
    expect(post.init?.credentials).toBe("include");
    expect((post.init?.headers as Record<string, string>)["x-csrf-token"]).toBe("tok-123456789");
    expect(JSON.parse(String(post.init?.body))).toEqual({ urls: [PRODUCT], tag: "minhaloja" });
  });

  it("token vencido: busca outro e tenta de novo uma vez", async () => {
    let posts = 0;
    const { fetch } = fakeFetch({
      [AFFILIATE_HUB_URL]: () => html(HUB_HTML, AFFILIATE_HUB_URL),
      [CREATE_LINK_URL]: () => (++posts === 1 ? new Response("{}", { status: 403 }) : json(CREATE_LINK_BODY)),
    });
    const result = await handleRequest("ml.createLink", { productUrl: PRODUCT, tag: "minhaloja" }, { fetch });
    expect(result.ok).toBe(true);
    expect(posts).toBe(2);
  });

  it("sem login no ML: erro em pt-BR pedindo para entrar na conta", async () => {
    const { fetch } = fakeFetch({ [AFFILIATE_HUB_URL]: () => html("<html></html>", "https://www.mercadolivre.com.br/jms/mlb/lgz/login") });
    const result = await handleRequest("ml.createLink", { productUrl: PRODUCT, tag: "minhaloja" }, { fetch });
    expect(result).toEqual({
      ok: false,
      error: "Você não está logada no Mercado Livre neste navegador. Entre na sua conta e tente de novo.",
    });
  });

  it("productInfo: título, preço, preço original e imagem", async () => {
    const { fetch } = fakeFetch({ [PRODUCT]: () => html(PRODUCT_HTML) });
    expect(await handleRequest("ml.productInfo", { productUrl: PRODUCT }, { fetch })).toEqual({
      ok: true,
      data: {
        title: "Controle DualSense",
        imageUrl: "https://http2.mlstatic.com/x.jpg",
        priceCents: 41757,
        originalPriceCents: 49990,
      },
    });
  });

  it("diagnóstico: mostra cada etapa e nunca o valor do token", async () => {
    const { fetch } = fakeFetch({
      [AFFILIATE_HUB_URL]: () => html(HUB_HTML, AFFILIATE_HUB_URL),
      [CREATE_LINK_URL]: () => json(CREATE_LINK_BODY),
      [PRODUCT]: () => html(PRODUCT_HTML),
    });
    const result = (await handleRequest("ml.diagnose", { productUrl: PRODUCT, tag: "minhaloja" }, { fetch })) as ExtensionResult<"ml.diagnose">;
    expect(result.ok && result.data.steps.map((s) => s.ok)).toEqual([true, true, true]);
    expect(JSON.stringify(result)).not.toContain("tok-123456789");
  });

  it("ping devolve a versão; pedido inválido é recusado sem chamar o ML", async () => {
    const { fetch, calls } = fakeFetch({});
    expect(await handleRequest("ping", {}, { fetch })).toEqual({ ok: true, data: { version: EXTENSION_VERSION } });
    expect((await handleRequest("ml.productInfo", { productUrl: "https://evil.com" }, { fetch })).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
