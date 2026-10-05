import { channelDailyLimitFor, forTenant, isWithinWindow, maxOffersPerHour, type Store } from "@achadinhos/db";
import { createTestDatabase, type TestDatabase } from "@achadinhos/db/testing";
import { MissingCredentialError, type ProductRef } from "@achadinhos/stores";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  discardExpiredPosts,
  pickForTenant,
  queueManualOffers,
  runAutopilotTick,
  runDispatch,
  type AutopilotDeps,
} from "../src/autopilot/engine";
import type { WhatsAppSender } from "../src/whatsapp/send";
import { silentLogger } from "./helpers";

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.close();
});
// Catálogo é global: cada teste começa com o catálogo vazio.
// Envio percorre todos os números: os dos testes anteriores saem de cena.
beforeEach(async () => {
  await db.prisma.catalogProduct.updateMany({ data: { active: false } });
  await db.prisma.channel.updateMany({ data: { status: "DISCONNECTED" } });
  await db.prisma.post.updateMany({ where: { status: { in: ["SCHEDULED", "SENDING", "AWAITING_LINK"] } }, data: { status: "CANCELED" } });
  await db.prisma.offer.updateMany({ where: { sendQueuedAt: null }, data: { sendRequestedAt: null } });
});

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Terça, 06/10/2026, 10:00 em São Paulo (13:00 UTC). */
const T0 = new Date("2026-10-06T13:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

interface FakeSocket extends WhatsAppSender {
  sent: { jid: string; text: string }[];
  fail: boolean;
}
function fakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    sent: [],
    fail: false,
    async sendMessage(jid, content) {
      if (socket.fail) throw new Error("Conexão perdida no envio.");
      socket.sent.push({ jid, text: "caption" in content ? content.caption : content.text });
      return { key: { id: `msg-${socket.sent.length}` } };
    },
  };
  return socket;
}

let slugCounter = 0;
async function setup(
  options: {
    groups?: number;
    stores?: Store[];
    settings?: Record<string, unknown>;
    connectedSince?: Date;
    maxOffersPerDay?: number;
  } = {},
) {
  const slug = `ap-${++slugCounter}`;
  const prisma = db.prisma;
  const tenant = await prisma.tenant.create({ data: { name: slug, slug } });
  const plan = await prisma.plan.create({
    data: {
      code: `plano-${slug}`,
      name: "Teste",
      priceCents: 100,
      maxWhatsappNumbers: 1,
      maxTelegramBots: 0,
      maxPostsPerDay: options.maxOffersPerDay ?? 40,
      maxUsers: 1,
      aiEnabled: false,
      reportsLevel: "BASIC",
    },
  });
  await prisma.subscription.create({
    data: { tenantId: tenant.id, planId: plan.id, status: "ACTIVE", currentPeriodStart: new Date(T0.getTime() - DAY), currentPeriodEnd: new Date(T0.getTime() + 30 * DAY) },
  });
  const channel = await prisma.channel.create({
    data: {
      tenantId: tenant.id,
      type: "WHATSAPP",
      name: "WhatsApp 1",
      status: "CONNECTED",
      firstConnectedAt: options.connectedSince ?? new Date(T0.getTime() - 30 * DAY),
    },
  });
  const groups = [];
  for (let i = 0; i < (options.groups ?? 2); i++) {
    groups.push(
      await prisma.group.create({
        data: { tenantId: tenant.id, channelId: channel.id, externalId: `${slug}-g${i}@g.us`, name: `Grupo ${i}`, postingEnabled: true },
      }),
    );
  }
  for (const store of options.stores ?? ["SHOPEE"]) {
    await prisma.storeCredential.create({
      data: { tenantId: tenant.id, store, ciphertext: Buffer.from("x"), iv: Buffer.alloc(12), authTag: Buffer.alloc(16) },
    });
  }
  await prisma.autopilotSettings.create({ data: { tenantId: tenant.id, enabled: true, ...options.settings } });
  const socket = fakeSocket();
  const links: { product: string; groupId: string | undefined }[] = [];
  const deps: AutopilotDeps = {
    prisma,
    logger: silentLogger,
    getSocket: (id) => (id === channel.id ? socket : undefined),
    generateLink: async (_tenantId: string, product: ProductRef, opts: { groupId?: string }) => {
      links.push({ product: product.externalId, groupId: opts.groupId });
      return `https://s.shopee.com.br/${product.externalId}-${opts.groupId ?? "base"}`;
    },
    random: () => 0.5,
    env: {},
  };
  return { tenant, channel, groups, socket, deps, links, tdb: forTenant(tenant.id, prisma) };
}

async function product(externalId: string, extra: Record<string, unknown> = {}) {
  return db.prisma.catalogProduct.upsert({
    where: { store_externalId: { store: "SHOPEE", externalId } },
    update: { active: true, lastSeenAt: T0, ...extra },
    create: {
      store: "SHOPEE",
      externalId,
      title: `Produto ${externalId}`,
      searchText: `produto ${externalId}`,
      productUrl: `https://shopee.com.br/product/1/${externalId}`,
      priceCents: 5000,
      originalPriceCents: 10000,
      discountPct: 50,
      rating: 4.8,
      commissionPct: 8,
      score: 50,
      lastSeenAt: T0,
      ...extra,
    },
  });
}

/** Roda envios até esvaziar a fila (avançando o relógio além do intervalo entre envios). */
async function sendAll(deps: AutopilotDeps, start: Date, maxSteps = 20) {
  let now = start;
  for (let i = 0; i < maxSteps; i++) {
    const results = await runDispatch(deps, now);
    if (!results.some((r) => "sent" in r || "failed" in r)) break;
    now = new Date(now.getTime() + 2 * MIN);
  }
  return now;
}

describe("regras puras", () => {
  it("janela: dia da semana e horário em São Paulo", () => {
    const s = { weekdays: [1, 2, 3, 4, 5], windowStartMinute: 8 * 60, windowEndMinute: 22 * 60 };
    expect(isWithinWindow(s, T0)).toBe(true); // terça 10:00
    expect(isWithinWindow(s, new Date("2026-10-06T10:59:00Z"))).toBe(false); // 07:59
    expect(isWithinWindow(s, new Date("2026-10-07T01:00:00Z"))).toBe(false); // 22:00 (fecha)
    expect(isWithinWindow(s, new Date("2026-10-04T13:00:00Z"))).toBe(false); // domingo
  });

  it("aquecimento: 20 no dia 1, sobe até o limite no dia 7", () => {
    const limits = [0, 1, 2, 3, 4, 5, 6, 10].map((d) => channelDailyLimitFor(new Date(T0.getTime() - d * DAY), 80, T0));
    expect(limits).toEqual([20, 30, 40, 50, 60, 70, 80, 80]);
  });

  it("cabe na hora: 10 grupos x 90 s + 5 min = 20 min -> 3 ofertas por hora", () => {
    expect(maxOffersPerHour(10, 90)).toBe(3);
    expect(maxOffersPerHour(1, 90)).toBe(9);
    expect(maxOffersPerHour(40, 90)).toBe(1);
  });
});

describe("piloto automático", () => {
  it("escolhe só dentro da janela e respeita o ritmo de ofertas por hora", async () => {
    const { tenant, deps } = await setup({ settings: { offersPerHour: 2 } });
    await product("p1", { score: 90 });
    await product("p2", { score: 80 });
    expect(await pickForTenant(deps, tenant.id, new Date("2026-10-06T10:00:00Z"))).toEqual({ picked: false, reason: "fora da janela" });
    expect(await pickForTenant(deps, tenant.id, T0)).toMatchObject({ picked: true, posts: 2 });
    expect(await pickForTenant(deps, tenant.id, at(10 * MIN))).toEqual({ picked: false, reason: "ritmo" });
    expect(await pickForTenant(deps, tenant.id, at(30 * MIN))).toMatchObject({ picked: true });
  });

  it("prioriza o ranking e aplica os filtros (preço, desconto, nota, comissão, preço recente)", async () => {
    const { tenant, deps, tdb } = await setup({
      settings: { minDiscountPct: 30, maxPriceCents: 10000, minRating: 4.5, minCommissionPct: 5 },
    });
    await product("caro", { score: 99, priceCents: 20000 });
    await product("sem-desconto", { score: 98, discountPct: 10 });
    await product("velho", { score: 97, lastSeenAt: new Date(T0.getTime() - 7 * HOUR) }); // preço de 7h atrás
    await product("bom", { score: 60 });
    await pickForTenant(deps, tenant.id, T0);
    const posts = await tdb.post.findMany();
    expect(new Set(posts.map((p) => p.productExternalId))).toEqual(new Set(["bom"]));
  });

  it("não repete o produto no mesmo grupo por 3 dias (loja + id + grupo)", async () => {
    const { tenant, deps, tdb, groups } = await setup({ settings: { offersPerHour: 12 } });
    await product("p1", { score: 90 });
    await product("p2", { score: 80 });
    await pickForTenant(deps, tenant.id, T0); // p1 nos 2 grupos
    await pickForTenant(deps, tenant.id, at(10 * MIN)); // p1 já foi: p2
    const byProduct = async () =>
      (await tdb.post.findMany({ orderBy: { createdAt: "asc" } })).map((p) => p.productExternalId);
    expect(await byProduct()).toEqual(["p1", "p1", "p2", "p2"]);

    // p1 postado só no grupo 0 há 2 dias (de outra oferta): vai só para o grupo 1.
    const fresh = await setup({ settings: { offersPerHour: 12 } });
    const offer = await fresh.tdb.offer.create({
      data: { tenantId: fresh.tenant.id, store: "SHOPEE", externalId: "p1", title: "x", url: "https://shopee.com.br/x" },
    });
    await fresh.tdb.post.create({
      data: {
        tenantId: fresh.tenant.id,
        offerId: offer.id,
        groupId: fresh.groups[0]!.id,
        shortCode: `old-${fresh.tenant.id}`,
        status: "SENT",
        sentAt: at(-2 * DAY),
        store: "SHOPEE",
        productExternalId: "p1",
        createdAt: at(-2 * DAY),
      },
    });
    const result = await pickForTenant(fresh.deps, fresh.tenant.id, T0);
    expect(result).toMatchObject({ picked: true, posts: 1 });
    const created = await fresh.tdb.post.findMany({ where: { source: "AUTO" } });
    expect(created.map((p) => [p.productExternalId, p.groupId])).toEqual([["p1", fresh.groups[1]!.id]]);
    // Passados os 3 dias, volta a poder no grupo 0.
    expect(groups.length).toBe(2);
  });

  it("loja sem credencial (ou inválida) fica de fora; credencial inválida pausa só aquela loja", async () => {
    const { tenant, deps, tdb } = await setup({ stores: ["SHOPEE"] });
    await product("p1");
    const failing: AutopilotDeps = {
      ...deps,
      generateLink: async () => {
        throw new MissingCredentialError("SHOPEE");
      },
    };
    expect(await pickForTenant(failing, tenant.id, T0)).toEqual({ picked: false, reason: "credencial inválida" });
    const credential = await tdb.storeCredential.findFirstOrThrow({ where: { store: "SHOPEE" } });
    expect(credential.autopilotPausedAt).not.toBeNull();
    expect(credential.lastError).toContain("Piloto automático pausado nesta loja");
    // Loja pausada: o piloto não tenta mais (nenhum produto utilizável).
    expect(await pickForTenant(deps, tenant.id, at(HOUR))).toEqual({ picked: false, reason: "nenhum produto" });
  });

  it("Mercado Livre: só com ML_AUTOPILOT_ENABLED=true E a extensão do cliente ativa; sai só com meli.la", async () => {
    const { tenant, deps, tdb, socket } = await setup({ stores: ["MERCADO_LIVRE"] });
    await db.prisma.catalogProduct.create({
      data: {
        store: "MERCADO_LIVRE",
        externalId: `MLB-${tenant.id}`,
        title: "ML",
        searchText: "ml",
        productUrl: "https://www.mercadolivre.com.br/p/MLB1",
        priceCents: 1000,
        score: 99,
        lastSeenAt: T0,
      },
    });
    const mlOn = { ...deps, env: { ML_AUTOPILOT_ENABLED: "true" } };
    const reset = () => tdb.autopilotSettings.update({ where: { tenantId: tenant.id }, data: { lastPickAt: null } });
    // Desligado no .env: nunca.
    expect(await pickForTenant(deps, tenant.id, T0)).toEqual({ picked: false, reason: "nenhum produto" });
    // Ligado, mas extensão do cliente sem sinal de vida recente: não escolhe ML.
    await reset();
    const user = await db.prisma.user.create({
      data: { tenantId: tenant.id, email: `${tenant.id}@teste.com`, name: "Cliente", passwordHash: "x" },
    });
    await db.prisma.extensionToken.create({
      data: { tenantId: tenant.id, userId: user.id, tokenHash: `h-${tenant.id}`, lastSeenAt: at(-11 * MIN) },
    });
    expect(await pickForTenant(mlOn, tenant.id, T0)).toEqual({ picked: false, reason: "nenhum produto" });
    // Extensão ativa: escolhe, e o post espera o meli.la (não envia com link longo).
    await reset();
    await tdb.extensionToken.updateMany({ data: { lastSeenAt: at(-1 * MIN) } });
    expect(await pickForTenant(mlOn, tenant.id, T0)).toMatchObject({ picked: true });
    expect((await tdb.post.findMany()).map((p) => p.status)).toEqual(["AWAITING_LINK", "AWAITING_LINK"]);
    await runDispatch(mlOn, at(MIN));
    expect(socket.sent).toHaveLength(0);
    // O meli.la não chegou no prazo: descartado.
    expect(await discardExpiredPosts(db.prisma, at(61 * MIN))).toBeGreaterThanOrEqual(2);
    expect((await tdb.post.findMany()).map((p) => p.status)).toEqual(["DISCARDED", "DISCARDED"]);
  });
});

describe("Amazon no piloto: só com link curto (link.amazon) da extensão do cliente", () => {
  it("sem extensão ativa não escolhe Amazon; com extensão, o post espera o link curto", async () => {
    const { tenant, deps, tdb, socket } = await setup({ stores: ["AMAZON"] });
    await db.prisma.catalogProduct.create({
      data: {
        store: "AMAZON",
        externalId: `B0${tenant.id.slice(-8).toUpperCase()}`,
        title: "Amazon",
        searchText: "amazon",
        productUrl: `https://www.amazon.com.br/dp/B0${tenant.id.slice(-8).toUpperCase()}`,
        priceCents: 1000,
        score: 99,
        lastSeenAt: T0,
      },
    });
    expect(await pickForTenant(deps, tenant.id, T0)).toEqual({ picked: false, reason: "nenhum produto" });
    await tdb.autopilotSettings.update({ where: { tenantId: tenant.id }, data: { lastPickAt: null } });
    const user = await db.prisma.user.create({
      data: { tenantId: tenant.id, email: `${tenant.id}@amz.com`, name: "Cliente", passwordHash: "x" },
    });
    await db.prisma.extensionToken.create({
      data: { tenantId: tenant.id, userId: user.id, tokenHash: `amz-${tenant.id}`, lastSeenAt: at(-2 * MIN) },
    });
    expect(await pickForTenant(deps, tenant.id, T0)).toMatchObject({ picked: true });
    expect((await tdb.post.findMany()).map((p) => p.status)).toEqual(["AWAITING_LINK", "AWAITING_LINK"]);
    await runDispatch(deps, at(MIN));
    expect(socket.sent).toHaveLength(0);
  });
});

describe("fila de envio", () => {
  it("encurtador próprio: o texto leva {base}/o/{código do post}; o post guarda o link de afiliado", async () => {
    const { tenant, deps, tdb, socket } = await setup();
    await product("p1");
    const withShort = { ...deps, shortLinkBase: "https://lnk.exemplo.com" };
    await pickForTenant(withShort, tenant.id, T0);
    await sendAll(withShort, T0);
    const posts = await tdb.post.findMany();
    expect(posts).toHaveLength(2);
    for (const post of posts) {
      expect(post.shortCode).toMatch(/^[A-Za-z0-9]{7}$/);
      expect(post.messageText).toContain(`https://lnk.exemplo.com/o/${post.shortCode}`);
      expect(post.messageText).not.toContain("s.shopee.com.br");
      expect(post.affiliateUrl).toBe(`https://s.shopee.com.br/p1-${post.groupId}`);
    }
    expect(new Set(posts.map((p) => p.shortCode)).size).toBe(2); // um código por oferta + grupo
    expect(socket.sent.every((m) => m.text.includes("https://lnk.exemplo.com/o/"))).toBe(true);
  });

  it("link da Shopee por grupo (subIds [tenant, grupo]) e histórico imutável", async () => {
    const { tenant, deps, tdb, groups, socket } = await setup();
    await product("p1");
    await pickForTenant(deps, tenant.id, T0);
    await sendAll(deps, T0);
    expect(socket.sent).toHaveLength(2);
    const posts = await tdb.post.findMany({ orderBy: { sentAt: "asc" } });
    for (const post of posts) {
      expect(post.status).toBe("SENT");
      expect(post.affiliateUrl).toBe(`https://s.shopee.com.br/p1-${post.groupId}`);
      expect(post.messageText).toContain(post.affiliateUrl!);
      expect(post.messageText).not.toContain("p1-base");
    }
    expect(new Set(posts.map((p) => p.groupId))).toEqual(new Set(groups.map((g) => g.id)));
    // Mudar a oferta depois não altera o que foi enviado.
    await tdb.offer.updateMany({ data: { messageText: "outro texto", priceCents: 1 } });
    const again = await tdb.post.findMany({ orderBy: { sentAt: "asc" } });
    expect(again.map((p) => [p.messageText, p.priceCents])).toEqual(posts.map((p) => [p.messageText, p.priceCents]));
  });

  it("intervalo aleatório entre envios do mesmo número (30 a 90 s)", async () => {
    const { tenant, deps, channel, socket } = await setup();
    await product("p1");
    await pickForTenant(deps, tenant.id, T0);
    await runDispatch(deps, T0);
    const after = await db.prisma.channel.findUniqueOrThrow({ where: { id: channel.id } });
    expect(after.nextSendAt!.getTime() - T0.getTime()).toBe(60_000); // random 0,5 -> 60 s
    await runDispatch(deps, at(30_000)); // ainda no intervalo: não envia
    expect(socket.sent).toHaveLength(1);
    await runDispatch(deps, at(60_000));
    expect(socket.sent).toHaveLength(2);
  });

  it("nunca envia fora da janela; descarta o que passou do horário (fila atrasada)", async () => {
    const { tenant, deps, tdb, socket } = await setup();
    await product("p1");
    await pickForTenant(deps, tenant.id, T0);
    // A fila "travou" por 61 min: nada é enviado de uma vez, tudo vira descartado.
    const result = await runAutopilotTick(deps, at(61 * MIN), { withPicks: false });
    expect(result.discarded).toBe(2);
    expect(socket.sent).toHaveLength(0);
    expect((await tdb.post.findMany()).map((p) => p.status)).toEqual(["DISCARDED", "DISCARDED"]);
  });

  it("post do piloto não passa do fim da janela", async () => {
    const { tenant, deps, tdb } = await setup();
    const late = new Date("2026-10-07T00:50:00Z"); // 21:50 em SP; janela fecha às 22:00
    await product("p1", { lastSeenAt: late });
    await pickForTenant(deps, tenant.id, late);
    const post = await tdb.post.findFirstOrThrow();
    expect(post.expiresAt!.toISOString()).toBe("2026-10-07T01:00:00.000Z");
    expect(await discardExpiredPosts(db.prisma, new Date("2026-10-07T01:01:00Z"))).toBeGreaterThanOrEqual(1);
  });

  it("limite diário do número (com aquecimento) conta mensagens", async () => {
    const { tenant, deps, socket } = await setup({
      groups: 3,
      connectedSince: T0, // dia 1 do aquecimento
      settings: { channelDailyLimit: 2, offersPerHour: 12 },
    });
    await product("p1");
    await pickForTenant(deps, tenant.id, T0);
    const end = await sendAll(deps, T0);
    expect(socket.sent).toHaveLength(2);
    const results = await runDispatch(deps, end);
    expect(results).toEqual([expect.objectContaining({ skipped: "limite diário do número" })]);
  });

  it("limite do plano conta OFERTAS: 1 oferta para 3 grupos conta 1", async () => {
    const { tenant, deps, tdb, socket } = await setup({ groups: 3, maxOffersPerDay: 1, settings: { offersPerHour: 12 } });
    await product("p1", { score: 90 });
    await product("p2", { score: 80 });
    await pickForTenant(deps, tenant.id, T0);
    await sendAll(deps, T0);
    expect(socket.sent).toHaveLength(3);
    expect(await pickForTenant(deps, tenant.id, at(20 * MIN))).toEqual({ picked: false, reason: "limite do plano" });
    // Oferta manual nova também espera (não entra no limite do dia).
    await tdb.offer.create({
      data: {
        tenantId: tenant.id,
        store: "SHOPEE",
        externalId: "manual",
        title: "Manual",
        url: "https://shopee.com.br/product/1/manual",
        affiliateUrl: "https://s.shopee.com.br/manual",
        messageText: "Oferta https://s.shopee.com.br/manual",
        status: "ACTIVE",
        sendRequestedAt: at(20 * MIN),
      },
    });
    await queueManualOffers(deps, at(20 * MIN));
    const results = await runDispatch(deps, at(25 * MIN));
    expect(results).toEqual([expect.objectContaining({ skipped: "limite de ofertas do plano" })]);
  });

  it("falha: tenta de novo com espera; após 3 posts seguidos com falha, pausa o número", async () => {
    const { tenant, deps, channel, socket, tdb } = await setup({ groups: 3 });
    await product("p1");
    await pickForTenant(deps, tenant.id, T0);
    socket.fail = true;
    let now = T0;
    for (let i = 0; i < 12; i++) {
      await runDispatch(deps, now);
      now = new Date(now.getTime() + 20 * MIN);
    }
    const posts = await tdb.post.findMany();
    expect(posts.every((p) => p.status === "FAILED" && p.attempts === 3)).toBe(true);
    const paused = await db.prisma.channel.findUniqueOrThrow({ where: { id: channel.id } });
    expect(paused.autopilotPausedAt).not.toBeNull();
    expect(paused.autopilotPauseReason).toContain("3 posts seguidos com falha");
    // Número pausado não envia mais nada.
    socket.fail = false;
    await pickForTenant(deps, tenant.id, at(5 * HOUR));
    expect(await runDispatch(deps, at(5 * HOUR))).toEqual([]);
  });

  it("manual: entra na mesma fila, espera a janela abrir (até 24h) e não é descartado à noite", async () => {
    const { tenant, deps, tdb, socket } = await setup();
    const night = new Date("2026-10-07T02:00:00Z"); // 23:00 em SP
    await tdb.offer.create({
      data: {
        tenantId: tenant.id,
        store: "AMAZON",
        externalId: "B000000001",
        title: "Manual",
        url: "https://www.amazon.com.br/dp/B000000001",
        affiliateUrl: "https://www.amazon.com.br/dp/B000000001?tag=cliente-20",
        messageText: "Oferta https://www.amazon.com.br/dp/B000000001?tag=cliente-20",
        status: "ACTIVE",
        sendRequestedAt: night,
      },
    });
    await runAutopilotTick(deps, night, { withPicks: false });
    expect(socket.sent).toHaveLength(0);
    const queued = await tdb.post.findMany();
    expect(queued.map((p) => [p.source, p.status])).toEqual([
      ["MANUAL", "SCHEDULED"],
      ["MANUAL", "SCHEDULED"],
    ]);
    // 08:00 do dia seguinte: a janela abre e envia (ainda dentro das 24h).
    const morning = new Date("2026-10-07T11:00:00Z");
    await sendAll(deps, morning);
    expect(socket.sent).toHaveLength(2);
    expect(socket.sent[0]!.text).toContain("tag=cliente-20");
  });
});

describe("headlines no piloto", () => {
  it("usa a headline do tipo do produto e não repete nas 10 últimas mensagens de cada grupo", async () => {
    const { tenant, deps, tdb } = await setup({ settings: { offersPerHour: 6 } });
    for (let i = 0; i < 14; i++) {
      await product(`hl-fone-${i}`, {
        title: `Fone de Ouvido Bluetooth Modelo ${i}`,
        category: "ELECTRONICS",
        headlineKey: "type:fone",
        discountPct: 20,
        score: 90 - i,
      });
    }
    deps.random = Math.random;
    for (let i = 0; i < 14; i++) {
      expect(await pickForTenant(deps, tenant.id, at(i * 10 * MIN))).toMatchObject({ picked: true });
    }
    const posts = await tdb.post.findMany({ orderBy: { createdAt: "asc" }, include: { offer: true } });
    const byGroup = new Map<string, string[]>();
    for (const p of posts) {
      expect(p.headline).toBeTruthy();
      expect(p.messageText).toContain(p.headline!);
      expect(p.offer.headline).toBe(p.headline);
      byGroup.set(p.groupId, [...(byGroup.get(p.groupId) ?? []), p.headline!]);
    }
    for (const list of byGroup.values()) {
      expect(list).toHaveLength(14);
      for (let i = 0; i < list.length; i++) {
        expect(list.slice(Math.max(0, i - 10), i), `post ${i}`).not.toContain(list[i]);
      }
    }
    // Primeira é do próprio tipo (fone).
    expect(["SOM DE QUALIDADE EM QUALQUER LUGAR 🎧", "SUA PLAYLIST NUNCA FOI TÃO BOA 🎶", "LIBERDADE SEM FIOS 🎧", "MERGULHE NA SUA MÚSICA 🎵"]).toContain(
      byGroup.values().next().value![0],
    );
  });

  it("headline fixa quando o cliente desliga as automáticas; envio manual leva a headline da oferta para os posts", async () => {
    const { tenant, deps, tdb } = await setup();
    await tdb.messageTemplate.create({
      data: { tenantId: tenant.id, body: "*{headline}*\n{titulo}\n{link}", headline: "MINHA FIXA 🔥", autoHeadlines: false },
    });
    await product("hl-fixa", { title: "Fone Bluetooth", headlineKey: "type:fone" });
    await pickForTenant(deps, tenant.id, T0);
    const auto = await tdb.post.findMany({ where: { productExternalId: "hl-fixa" } });
    expect(auto.map((p) => p.headline)).toEqual(["MINHA FIXA 🔥", "MINHA FIXA 🔥"]);

    const offer = await tdb.offer.create({
      data: {
        tenantId: tenant.id,
        store: "SHOPEE",
        externalId: "hl-manual",
        title: "Panela",
        url: "https://shopee.com.br/product/1/hl-manual",
        affiliateUrl: "https://s.shopee.com.br/x",
        messageText: "*ESCOLHIDA À MÃO 🍳*",
        headline: "ESCOLHIDA À MÃO 🍳",
        status: "ACTIVE",
        sendRequestedAt: T0,
      },
    });
    await queueManualOffers(deps, T0);
    const manual = await tdb.post.findMany({ where: { offerId: offer.id } });
    expect(manual.length).toBe(2);
    expect(manual.every((p) => p.headline === "ESCOLHIDA À MÃO 🍳")).toBe(true);
  });
});
