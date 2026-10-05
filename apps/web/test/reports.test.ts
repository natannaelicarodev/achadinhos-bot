import { forTenant } from "@achadinhos/db";
import { createTestDatabase, type TestDatabase } from "@achadinhos/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTable, canSee, loadReportData, parsePeriod, planNameFor, spDayKey, toCsv } from "@/lib/reports";
import { trackedLinksBase } from "@/lib/short-domain";

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.close();
});

/** Segunda, 05/10/2026, 10:00 em São Paulo. */
const NOW = new Date("2026-10-05T13:00:00Z");

describe("período", () => {
  it("padrão 30 dias até hoje em São Paulo; presets 7/30/90", () => {
    const p = parsePeriod({}, NOW);
    expect(p.days).toHaveLength(30);
    expect(p.days.at(-1)).toBe("2026-10-05");
    expect(p.from.toISOString()).toBe("2026-09-06T03:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-10-06T03:00:00.000Z");
    expect(parsePeriod({ periodo: "7" }, NOW).days[0]).toBe("2026-09-29");
    expect(parsePeriod({ periodo: "90" }, NOW).days).toHaveLength(90);
    expect(parsePeriod({ periodo: "999" }, NOW).preset).toBe(30);
  });

  it("de/até: inclui o último dia inteiro; futuro corta em hoje; inválido volta ao padrão", () => {
    const p = parsePeriod({ de: "2026-09-01", ate: "2026-09-03" }, NOW);
    expect(p.days).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(p.to.toISOString()).toBe("2026-09-04T03:00:00.000Z");
    expect(p.label).toBe("01/09/2026 a 03/09/2026");
    expect(parsePeriod({ de: "2026-10-01", ate: "2027-01-01" }, NOW).days.at(-1)).toBe("2026-10-05");
    expect(parsePeriod({ de: "2026-09-10", ate: "2026-09-01" }, NOW).preset).toBe(30);
    expect(parsePeriod({ de: "2020-01-01", ate: "2026-10-01" }, NOW).preset).toBe(30); // mais de 366 dias
    expect(parsePeriod({ de: "abc", ate: "2026-10-01" }, NOW).preset).toBe(30);
  });

  it("dia em São Paulo: 23h de Brasília ainda é o mesmo dia", () => {
    expect(spDayKey(new Date("2026-10-06T02:30:00Z"))).toBe("2026-10-05");
    expect(spDayKey(new Date("2026-10-06T03:00:00Z"))).toBe("2026-10-06");
  });
});

describe("acesso por plano", () => {
  it("Iniciante: dia, loja e Shopee por grupo; Pro: + grupo e oferta; Agência: + CSV", () => {
    expect(["daily", "stores", "shopeeGroups"].every((f) => canSee("BASIC", f as never))).toBe(true);
    expect(canSee("BASIC", "groups")).toBe(false);
    expect(canSee("BASIC", "offers")).toBe(false);
    expect(canSee("GROUPS", "groups") && canSee("GROUPS", "offers")).toBe(true);
    expect(canSee("GROUPS", "csv")).toBe(false);
    expect(canSee("FULL", "csv")).toBe(true);
  });

  it("bloqueio mostra o nome do plano que libera", () => {
    expect(planNameFor("daily")).toBe("Iniciante");
    expect(planNameFor("groups")).toBe("Pro");
    expect(planNameFor("offers")).toBe("Pro");
    expect(planNameFor("csv")).toBe("Agência");
  });
});

describe("link rastreável", () => {
  it("só com TRACKED_LINKS_ENABLED e o domínio de links curtos (nunca o do painel)", () => {
    expect(trackedLinksBase({ TRACKED_LINKS_ENABLED: "true", SHORT_LINK_BASE_URL: "https://lnk.exemplo.com/" })).toBe("https://lnk.exemplo.com");
    expect(trackedLinksBase({ TRACKED_LINKS_ENABLED: "true", APP_URL: "https://painel.exemplo.com" })).toBeNull();
    expect(trackedLinksBase({ TRACKED_LINKS_ENABLED: "false", SHORT_LINK_BASE_URL: "https://lnk.exemplo.com" })).toBeNull();
  });
});

let slug = 0;
async function seed() {
  const s = `rep-${++slug}`;
  const p = db.prisma;
  const tenant = await p.tenant.create({ data: { name: s, slug: s } });
  const channel = await p.channel.create({ data: { tenantId: tenant.id, type: "WHATSAPP", name: "W" } });
  const g1 = await p.group.create({ data: { tenantId: tenant.id, channelId: channel.id, externalId: `${s}-1@g.us`, name: "Achados A", participantsCount: 200 } });
  const g2 = await p.group.create({ data: { tenantId: tenant.id, channelId: channel.id, externalId: `${s}-2@g.us`, name: "Achados B" } });
  const fone = await p.offer.create({ data: { tenantId: tenant.id, store: "SHOPEE", title: "Fone Bluetooth", url: "https://shopee.com.br/1", affiliateUrl: "https://s.shopee.com.br/1" } });
  const tenis = await p.offer.create({ data: { tenantId: tenant.id, store: "MERCADO_LIVRE", title: "Tênis; \"Corrida\"", url: "https://mercadolivre.com.br/2", affiliateUrl: "https://meli.la/2" } });
  const post = (groupId: string, offerId: string, sentAt: Date | null, n: number) =>
    p.post.create({ data: { tenantId: tenant.id, offerId, groupId, shortCode: `${s}${n}`.slice(-12), status: sentAt ? "SENT" : "SCHEDULED", sentAt } });
  await post(g1.id, fone.id, new Date("2026-10-04T15:00:00Z"), 1);
  await post(g1.id, tenis.id, new Date("2026-10-05T12:00:00Z"), 2);
  await post(g2.id, fone.id, new Date("2026-10-04T15:00:00Z"), 3);
  await post(g2.id, tenis.id, null, 4); // não enviado: não conta mensagem
  const click = (groupId: string | null, offerId: string, at: string) =>
    p.click.create({ data: { tenantId: tenant.id, groupId, offerId, createdAt: new Date(at) } });
  await click(g1.id, fone.id, "2026-10-04T16:00:00Z");
  await click(g1.id, fone.id, "2026-10-04T17:00:00Z");
  await click(g1.id, tenis.id, "2026-10-05T12:30:00Z");
  await click(g2.id, fone.id, "2026-10-04T16:00:00Z");
  await click(null, tenis.id, "2026-10-05T02:00:00Z"); // 23h do dia 04 em Brasília
  await click(g1.id, fone.id, "2026-08-01T12:00:00Z"); // fora do período
  const sale = (groupId: string | null, offerId: string | null, id: string, status: string, cents: number) =>
    p.conversion.create({
      data: { tenantId: tenant.id, store: "SHOPEE", externalOrderId: id, groupId, offerId, amountCents: cents, commissionCents: cents / 10, status, occurredAt: new Date("2026-10-04T20:00:00Z") },
    });
  await sale(g1.id, fone.id, `${s}-o1`, "COMPLETED", 10000);
  await sale(g1.id, fone.id, `${s}-o2`, "PENDING", 5000);
  await sale(g2.id, fone.id, `${s}-o3`, "CANCELLED", 3000);
  await sale(null, null, `${s}-o4`, "COMPLETED", 2000);
  return { tenant, g1, g2, fone, tenis };
}

describe("dados do relatório", () => {
  it("cliques por dia, loja, grupo e oferta; taxa por grupo; Shopee por grupo; ofertas que mais venderam", async () => {
    const { tenant, g1, g2, fone } = await seed();
    const period = parsePeriod({ periodo: "7" }, NOW);
    const data = await loadReportData(forTenant(tenant.id, db.prisma), period);

    expect(data.clicks.total).toBe(5);
    expect(data.clicks.byDay.find((d) => d.day === "2026-10-04")?.clicks).toBe(4); // inclui o das 23h
    expect(data.clicks.byDay.find((d) => d.day === "2026-10-05")?.clicks).toBe(1);
    expect(data.clicks.byDay).toHaveLength(7);
    expect(data.clicks.byStore).toEqual([
      { store: "SHOPEE", clicks: 3 },
      { store: "MERCADO_LIVRE", clicks: 2 },
    ]);
    expect(data.clicks.byGroup[0]).toMatchObject({ groupId: g1.id, name: "Achados A", clicks: 3 });
    expect(data.clicks.byGroup.find((g) => g.groupId === null)?.name).toMatch(/Fora dos grupos/);
    expect(data.clicks.byOffer[0]).toMatchObject({ offerId: fone.id, clicks: 3 });

    const a = data.rates.find((r) => r.groupId === g1.id)!;
    expect(a).toMatchObject({ messages: 2, clicks: 3, members: 200, clicksPerMessage: 1.5 });
    expect(a.pctMembers).toBeCloseTo(0.75); // 3 ÷ (2 × 200)
    expect(data.rates.find((r) => r.groupId === g2.id)).toMatchObject({ messages: 1, clicks: 1, members: null, pctMembers: null });

    expect(data.shopee.total).toMatchObject({ orders: 3, amountCents: 17000, commissionCents: 1200, pendingCents: 500, canceled: 1 });
    expect(data.shopee.byGroup[0]).toMatchObject({ name: "Achados A", orders: 2, commissionCents: 1000, pendingCents: 500 });
    expect(data.topOffers).toHaveLength(1);
    expect(data.topOffers[0]).toMatchObject({ offerId: fone.id, clicks: 3, orders: 2, canceled: 1 });
  });

  it("só dados do próprio cliente", async () => {
    const mine = await seed();
    await seed(); // outro cliente com os mesmos dados
    const data = await loadReportData(forTenant(mine.tenant.id, db.prisma), parsePeriod({ periodo: "7" }, NOW));
    expect(data.clicks.total).toBe(5);
    expect(data.shopee.total.orders).toBe(3);
    const offerIds = data.clicks.byOffer.map((o) => o.offerId);
    expect(offerIds.every((id) => [mine.fone.id, mine.tenis.id].includes(id))).toBe(true);
  });
});

describe("CSV", () => {
  it("Excel em português: BOM, ';', CRLF, vírgula decimal, aspas e proteção contra fórmula", async () => {
    const { tenant } = await seed();
    const data = await loadReportData(forTenant(tenant.id, db.prisma), parsePeriod({ periodo: "7" }, NOW));
    const csv = toCsv(buildTable("ofertas-cliques", data));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Oferta;Loja;Cliques\r\n");
    expect(csv).toContain('"Tênis; ""Corrida""";Mercado Livre;2');
    const sales = toCsv(buildTable("vendas-grupos", data));
    expect(sales).toContain("Achados A;2;150,00;10,00;5,00;0");
    expect(toCsv({ headers: ["a"], rows: [["=HYPERLINK(\"x\")"], ["-10"], ["@SUM(A1)"]] })).toContain("\"'=HYPERLINK(\"\"x\"\")\"\r\n'-10\r\n'@SUM(A1)");
    const rate = toCsv(buildTable("taxa", data));
    expect(rate).toContain("Achados A;2;3;1,50;200;0,75");
  });
});
