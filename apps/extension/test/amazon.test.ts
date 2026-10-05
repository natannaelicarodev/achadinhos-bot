import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  amazonLongUrl,
  asinOf,
  bestsellersUrl,
  createAmazonShortLink,
  fullSizeImage,
  parseAmazonProductPage,
  parseBestsellers,
  parseBrl,
  parseShortUrlResponse,
  SITESTRIPE_SHORT_URL,
} from "../src/amazon";
import { handleRequest } from "../src/handlers";
import type { ExtensionResult } from "../src/protocol";
import { collectAmazonVitrine } from "../src/vitrine";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const PRODUCT = "https://www.amazon.com.br/dp/B0CM3C9HRG";
const TAG = "cliente-20";

describe("Amazon: link curto pela SiteStripe", () => {
  it("monta o mesmo pedido da SiteStripe (endereço longo com a etiqueta do cliente, marketplace Brasil)", async () => {
    let called = "";
    const http = (async (url: string) => {
      called = url;
      return new Response(JSON.stringify({ ok: true, longUrl: "x", shortUrl: "https://link.amazon/B0Ex4mpl0", isOk: true }));
    }) as unknown as typeof fetch;
    await expect(createAmazonShortLink(http, PRODUCT, TAG)).resolves.toEqual({ shortUrl: "https://link.amazon/B0Ex4mpl0" });
    const url = new URL(called);
    expect(`${url.origin}${url.pathname}`).toBe(SITESTRIPE_SHORT_URL);
    expect(url.searchParams.get("longUrl")).toBe(amazonLongUrl("B0CM3C9HRG", TAG));
    expect(url.searchParams.get("longUrl")).toContain("tag=cliente-20");
    expect(url.searchParams.get("marketplaceId")).toBe("526970");
    expect(url.searchParams.get("storeId")).toBe(TAG);
  });

  it("sem login de Associados (HTML no lugar do JSON) ou resposta sem link: erro em pt-BR", () => {
    expect(() => parseShortUrlResponse("<html>Fazer login</html>")).toThrow("Associados");
    expect(() => parseShortUrlResponse(JSON.stringify({ ok: false }))).toThrow("não gerou o link curto");
    expect(() => parseShortUrlResponse(JSON.stringify({ ok: true, shortUrl: "https://evil.example/x" }))).toThrow();
    expect(parseShortUrlResponse(JSON.stringify({ isOk: true, shortUrl: "https://amzn.to/3Ex4mpl" }))).toEqual({
      shortUrl: "https://amzn.to/3Ex4mpl",
    });
  });

  it("captcha da Amazon vira aviso claro", async () => {
    const http = (async () => new Response("<form action='/errors/validateCaptcha'>", { status: 200 })) as unknown as typeof fetch;
    await expect(createAmazonShortLink(http, PRODUCT, TAG)).rejects.toThrow("captcha");
  });

  it("protocolo: recusa produto fora da Amazon e etiqueta fora do formato", async () => {
    const http = (async () => new Response("{}")) as unknown as typeof fetch;
    const bad = (await handleRequest("amz.createLink", { productUrl: "https://evil.example/dp/B0CM3C9HRG", tag: TAG }, { fetch: http })) as ExtensionResult<"amz.createLink">;
    expect(bad).toEqual({ ok: false, error: "Endereço de produto da Amazon inválido." });
    const badTag = (await handleRequest("amz.createLink", { productUrl: PRODUCT, tag: "semnumero" }, { fetch: http })) as ExtensionResult<"amz.createLink">;
    expect(badTag.ok).toBe(false);
  });
});

describe("Amazon: página do produto e mais vendidos (trechos reais)", () => {
  it("lê título, preço, preço 'De' e imagem grande da página do produto", () => {
    expect(parseAmazonProductPage(fixture("amazon-product.html"))).toEqual({
      title: expect.stringContaining("GameSir G8 Galileo"),
      imageUrl: "https://m.media-amazon.com/images/I/61MjgicR7qL.jpg",
      priceCents: 30593,
      originalPriceCents: 33900,
    });
  });

  it("lê os cards dos mais vendidos: ASIN, posição, título, preço, nota e avaliações", () => {
    const items = parseBestsellers(fixture("amazon-bestsellers.html"));
    expect(items[0]).toEqual({
      asin: "B097BYXGXN",
      rank: 1,
      productUrl: "https://www.amazon.com.br/dp/B097BYXGXN",
      title: "Heinz Ketchup Tradicional 1,033KG",
      imageUrl: "https://images-na.ssl-images-amazon.com/images/I/51653ltvYsL.jpg",
      priceCents: 2124,
      rating: 4.9,
      ratingsCount: 26113,
    });
    expect(items[1]).toMatchObject({ asin: "B0CZS2LGFD", rank: 2, title: "O-LIVE & Co, Azeite de oliva extra virgem, Chileno, vidro, 450ml" });
  });

  it("utilitários: ASIN, preço em reais, imagem sem tamanho, página 2", () => {
    expect(asinOf("https://www.amazon.com.br/GameSir/dp/B0CM3C9HRG?pd_rd_w=x")).toBe("B0CM3C9HRG");
    expect(asinOf("https://www.amazon.com.br/gp/product/b0cm3c9hrg/")).toBe("B0CM3C9HRG");
    expect(parseBrl("R$ 1.305,93")).toBe(130593);
    expect(parseBrl("R$305,93")).toBe(30593);
    expect(fullSizeImage("https://m.media-amazon.com/images/I/61MjgicR7qL._AC_SX342_.jpg")).toBe("https://m.media-amazon.com/images/I/61MjgicR7qL.jpg");
    expect(bestsellersUrl("grocery", 2)).toBe("https://www.amazon.com.br/gp/bestsellers/grocery/?pg=2");
  });
});

describe("Amazon: vitrine compartilhada", () => {
  const noPause = async () => undefined;
  const one = (asin: string) => ({ asin, rank: 1, productUrl: `https://www.amazon.com.br/dp/${asin}`, title: "x", imageUrl: null, priceCents: 100, rating: 4.8, ratingsCount: 10 });

  it("lê 2 páginas por categoria", async () => {
    const calls: string[] = [];
    const batches = await collectAmazonVitrine(async (slug, page) => {
      calls.push(`${slug}:${page}`);
      return [one(`B00000000${page}`)];
    }, ["grocery", "beauty"], { pause: noPause });
    expect(calls).toEqual(["grocery:1", "grocery:2", "beauty:1", "beauty:2"]);
    expect(batches.map((b) => [b.slug, b.items.length])).toEqual([["grocery", 2], ["beauty", 2]]);
  });

  it("captcha PARA a coleta (não insiste) e mantém o que já leu", async () => {
    const calls: string[] = [];
    const batches = await collectAmazonVitrine(async (slug, page) => {
      calls.push(`${slug}:${page}`);
      if (slug === "beauty") throw new Error("A Amazon pediu uma verificação (captcha).");
      return [one("B000000001")];
    }, ["grocery", "beauty", "hpc"], { pause: noPause });
    expect(calls).toEqual(["grocery:1", "grocery:2", "beauty:1"]);
    expect(batches.map((b) => b.slug)).toEqual(["grocery"]);
  });
});
