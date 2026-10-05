import { createTestDatabase, type TestDatabase } from "@achadinhos/db/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CLICK_DEDUP_MS, hashIp, isBotRequest, recordClick, safeRedirectTarget } from "@/lib/clicks";
import { shortDomainRedirect, shortLinkBase } from "@/lib/short-domain";

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
  // A rota usa getPrisma(): aponta para o banco de teste.
  vi.doMock("@achadinhos/db", async (original) => ({
    ...(await original<typeof import("@achadinhos/db")>()),
    getPrisma: () => db.prisma,
  }));
});
afterAll(async () => {
  await db?.close();
});

const NOW = new Date("2026-10-06T13:00:00Z");
const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const req = (headers: Record<string, string>, method = "GET") => ({ method, headers: new Headers(headers) });

async function seedPost(slug: string, affiliateUrl = "https://s.shopee.com.br/AbC123") {
  const prisma = db.prisma;
  const tenant = await prisma.tenant.create({ data: { name: slug, slug } });
  const channel = await prisma.channel.create({ data: { tenantId: tenant.id, type: "WHATSAPP", name: "W" } });
  const group = await prisma.group.create({ data: { tenantId: tenant.id, channelId: channel.id, externalId: `${slug}@g.us`, name: "Grupo" } });
  const offer = await prisma.offer.create({
    data: { tenantId: tenant.id, store: "SHOPEE", title: "Produto", url: "https://shopee.com.br/x", affiliateUrl },
  });
  const post = await prisma.post.create({
    data: { tenantId: tenant.id, offerId: offer.id, groupId: group.id, shortCode: `c${slug}`.slice(0, 12), status: "SENT", affiliateUrl },
  });
  return { tenant, group, offer, post };
}

describe("robôs de prévia e automações não contam", () => {
  it.each([
    "WhatsApp/2.23.20.0 A",
    "TelegramBot (like TwitterBot)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0",
    "Mozilla/5.0 (compatible; Discordbot/2.0)",
    "Mozilla/5.0 (compatible; Googlebot/2.1)",
    "curl/8.4.0",
    "python-requests/2.31",
    "Mozilla/5.0 HeadlessChrome/120.0",
  ])("%s", (ua) => {
    expect(isBotRequest(req({ "user-agent": ua }))).toBe(true);
  });

  it("pessoa no celular conta; HEAD, sem navegador e pré-carregamento não", () => {
    expect(isBotRequest(req({ "user-agent": PHONE_UA }))).toBe(false);
    expect(isBotRequest(req({ "user-agent": PHONE_UA }, "HEAD"))).toBe(true);
    expect(isBotRequest(req({}))).toBe(true);
    expect(isBotRequest(req({ "user-agent": PHONE_UA, "sec-purpose": "prefetch;prerender" }))).toBe(true);
  });
});

describe("registro do clique", () => {
  it("registra tenant, grupo, oferta, post, data e navegador, sem o IP", async () => {
    const { post, group, offer, tenant } = await seedPost("clk-ok");
    const result = await recordClick(db.prisma, post, req({ "user-agent": PHONE_UA, "x-forwarded-for": "189.40.1.23, 10.0.0.1" }), {
      now: NOW,
      secret: "segredo-de-teste",
    });
    expect(result).toBe("counted");
    const click = await db.prisma.click.findFirstOrThrow({ where: { postId: post.id } });
    expect(click).toMatchObject({ tenantId: tenant.id, groupId: group.id, offerId: offer.id, userAgent: PHONE_UA, createdAt: NOW });
    expect(click.ipHash).toBe(hashIp("189.40.1.23", "segredo-de-teste"));
    expect(JSON.stringify(click)).not.toContain("189.40.1.23");
  });

  it("mesmo IP no mesmo post conta 1 vez a cada 30 min; robô nunca conta", async () => {
    const { post } = await seedPost("clk-dedup");
    const person = req({ "user-agent": PHONE_UA, "x-forwarded-for": "177.1.1.1" });
    const at = (ms: number) => ({ now: new Date(NOW.getTime() + ms), secret: "s" });
    expect(await recordClick(db.prisma, post, person, at(0))).toBe("counted");
    expect(await recordClick(db.prisma, post, person, at(5 * 60_000))).toBe("repeat");
    expect(await recordClick(db.prisma, post, req({ "user-agent": PHONE_UA, "x-forwarded-for": "177.2.2.2" }), at(6 * 60_000))).toBe("counted");
    expect(await recordClick(db.prisma, post, person, at(CLICK_DEDUP_MS + 1))).toBe("counted");
    expect(await recordClick(db.prisma, post, req({ "user-agent": "WhatsApp/2.23.20.0 A" }), at(0))).toBe("bot");
    expect(await db.prisma.click.count({ where: { postId: post.id } })).toBe(3);
  });

  it("só redireciona para https", () => {
    expect(safeRedirectTarget("https://meli.la/Ex4mpl0")).toBe("https://meli.la/Ex4mpl0");
    expect(safeRedirectTarget("javascript:alert(1)")).toBeNull();
    expect(safeRedirectTarget("http://exemplo.com")).toBeNull();
    expect(safeRedirectTarget(null)).toBeNull();
  });
});

describe("rota /o/[codigo]", () => {
  it("302 para o link de afiliado e conta o clique; prévia do WhatsApp redireciona sem contar; código inexistente 404", async () => {
    const { post } = await seedPost("clk-route", "https://link.amazon/B0Ex4mpl0");
    const { GET, HEAD } = await import("@/app/o/[code]/route");
    const call = (ua: string, code = post.shortCode) =>
      GET(new Request(`http://localhost:3000/o/${code}`, { headers: { "user-agent": ua, "x-forwarded-for": "200.1.1.1" } }), {
        params: Promise.resolve({ code }),
      });

    const preview = await call("WhatsApp/2.23.20.0 A");
    expect(preview.status).toBe(302);
    expect(preview.headers.get("location")).toBe("https://link.amazon/B0Ex4mpl0");
    expect(await db.prisma.click.count({ where: { postId: post.id } })).toBe(0);

    const person = await call(PHONE_UA);
    expect(person.status).toBe(302);
    expect(person.headers.get("cache-control")).toBe("no-store");
    expect(await db.prisma.click.count({ where: { postId: post.id } })).toBe(1);

    expect((await call(PHONE_UA, "naoexiste")).status).toBe(404);
    const head = await HEAD(new Request(`http://localhost:3000/o/${post.shortCode}`, { method: "HEAD" }), {
      params: Promise.resolve({ code: post.shortCode }),
    });
    expect(head.status).toBe(302);
    expect(await db.prisma.click.count({ where: { postId: post.id } })).toBe(1);
  });
});

describe("domínio separado dos links curtos", () => {
  const env = { APP_URL: "https://painel.achadinhos.com.br", SHORT_LINK_BASE_URL: "https://ach.ad" };
  const at = (url: string) => {
    const u = new URL(url);
    return shortDomainRedirect(u, u.host, env);
  };

  it("no domínio curto só /o/ responde; login e /painel vão para o APP_URL", () => {
    expect(at("https://ach.ad/o/AbC1234")).toBeNull();
    expect(at("https://ach.ad/login")).toBe("https://painel.achadinhos.com.br/login");
    expect(at("https://ach.ad/painel/catalogo?x=1")).toBe("https://painel.achadinhos.com.br/painel/catalogo?x=1");
    expect(at("https://ach.ad/")).toBe("https://painel.achadinhos.com.br/");
  });

  it("no domínio do painel nada muda; sem domínio separado também não", () => {
    expect(at("https://painel.achadinhos.com.br/painel")).toBeNull();
    const u = new URL("http://localhost:3000/painel");
    expect(shortDomainRedirect(u, u.host, { APP_URL: "http://localhost:3000" })).toBeNull();
  });

  it("127.0.0.1 e localhost são o mesmo endereço (sem separação, sem loop no computador)", () => {
    const u = new URL("http://127.0.0.1:3000/painel");
    expect(shortDomainRedirect(u, u.host, { APP_URL: "http://localhost:3000", SHORT_LINK_BASE_URL: "http://127.0.0.1:3000" })).toBeNull();
    // Parecido não é igual: só o 127.0.0.1 exato vira localhost.
    const other = new URL("http://127a0b0c1:3000/painel");
    expect(shortDomainRedirect(other, other.host, { APP_URL: "http://localhost:3000", SHORT_LINK_BASE_URL: "http://127a0b0c1:3000" })).toBe(
      "http://localhost:3000/painel",
    );
  });

  it("base dos links: SHORT_LINK_BASE_URL, senão APP_URL (sem barra no fim)", () => {
    expect(shortLinkBase(env)).toBe("https://ach.ad");
    expect(shortLinkBase({ APP_URL: "http://localhost:3000/" })).toBe("http://localhost:3000");
  });
});
