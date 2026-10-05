import { createTestDatabase, type TestDatabase } from "@achadinhos/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyShortLink, authenticateExtension, hashExtensionToken, newExtensionToken } from "@/lib/extension-autopilot";

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.close();
});

const NOW = new Date("2026-10-06T13:00:00Z");
const LONG = "https://www.mercadolivre.com.br/p/MLB1?matt_word=minhaloja&matt_tool=123";

async function seed(slug: string) {
  const prisma = db.prisma;
  const tenant = await prisma.tenant.create({ data: { name: slug, slug } });
  const user = await prisma.user.create({ data: { tenantId: tenant.id, email: `${slug}@x.com`, name: slug, passwordHash: "x" } });
  const channel = await prisma.channel.create({ data: { tenantId: tenant.id, type: "WHATSAPP", name: "W" } });
  const groups = await Promise.all(
    [1, 2].map((i) => prisma.group.create({ data: { tenantId: tenant.id, channelId: channel.id, externalId: `${slug}-${i}@g.us`, name: `G${i}` } })),
  );
  const offer = await prisma.offer.create({
    data: { tenantId: tenant.id, store: "MERCADO_LIVRE", externalId: "MLB1", title: "Produto", url: "https://www.mercadolivre.com.br/p/MLB1" },
  });
  for (const g of groups) {
    await prisma.post.create({
      data: {
        tenantId: tenant.id,
        offerId: offer.id,
        groupId: g.id,
        shortCode: `${slug}-${g.id}`,
        status: "AWAITING_LINK",
        source: "AUTO",
        store: "MERCADO_LIVRE",
        affiliateUrl: LONG,
        messageText: `Oferta! ${LONG}`,
      },
    });
  }
  return { tenant, user, offer };
}

describe("piloto + links curtos pela extensão do cliente", () => {
  it("chave da extensão: só o hash fica no banco; chave certa vira o tenant e marca o sinal de vida", async () => {
    const { tenant, user } = await seed("ext-auth");
    const token = newExtensionToken();
    await db.prisma.extensionToken.create({ data: { tenantId: tenant.id, userId: user.id, tokenHash: hashExtensionToken(token) } });
    expect(await authenticateExtension(db.prisma, `Bearer ${token}`, NOW)).toMatchObject({ tenantId: tenant.id });
    expect((await db.prisma.extensionToken.findFirstOrThrow({ where: { tenantId: tenant.id } })).lastSeenAt).toEqual(NOW);
    expect(await authenticateExtension(db.prisma, `Bearer ${newExtensionToken()}`, NOW)).toBeNull();
    expect(await authenticateExtension(db.prisma, null, NOW)).toBeNull();
    expect(await db.prisma.extensionToken.count({ where: { tokenHash: token } })).toBe(0);
  });

  it("meli.la conferido troca o link longo nos posts e libera o envio", async () => {
    const { tenant, offer } = await seed("ext-apply");
    const result = await applyShortLink(db.prisma, tenant.id, { offerId: offer.id, shortUrl: "https://meli.la/Ex4mpl0?x=1" }, async () => "https://meli.la/Ex4mpl0", NOW);
    expect(result).toEqual({ ok: true, posts: 2 });
    const posts = await db.prisma.post.findMany({ where: { offerId: offer.id } });
    for (const p of posts) {
      expect(p.status).toBe("SCHEDULED");
      expect(p.affiliateUrl).toBe("https://meli.la/Ex4mpl0");
      expect(p.messageText).toBe("Oferta! https://meli.la/Ex4mpl0");
    }
  });

  it("meli.la que não é do cliente é recusado (posts continuam esperando)", async () => {
    const { tenant, offer } = await seed("ext-reject");
    const result = await applyShortLink(db.prisma, tenant.id, { offerId: offer.id, shortUrl: "https://meli.la/Outra" }, async () => null, NOW);
    expect(result).toEqual({ ok: false, posts: 0 });
    const posts = await db.prisma.post.findMany({ where: { offerId: offer.id } });
    expect(posts.every((p) => p.status === "AWAITING_LINK" && p.affiliateUrl === LONG)).toBe(true);
  });

  it("oferta de outro tenant não é alterada", async () => {
    const a = await seed("ext-a");
    const b = await seed("ext-b");
    const result = await applyShortLink(db.prisma, a.tenant.id, { offerId: b.offer.id, shortUrl: "https://meli.la/x" }, async () => "https://meli.la/x", NOW);
    expect(result).toEqual({ ok: false, posts: 0 });
    expect(await db.prisma.post.count({ where: { offerId: b.offer.id, status: "AWAITING_LINK" } })).toBe(2);
  });

  it("Amazon: o link conferido recebe a loja e o produto da oferta", async () => {
    const { tenant, offer } = await seed("ext-amz");
    await db.prisma.offer.update({ where: { id: offer.id }, data: { store: "AMAZON", externalId: "B0CM3C9HRG" } });
    let seen: { store: string; externalId: string | null } | null = null;
    const result = await applyShortLink(db.prisma, tenant.id, { offerId: offer.id, shortUrl: "https://link.amazon/B0Ex4mpl0" }, async (_url, o) => {
      seen = o;
      return "https://link.amazon/B0Ex4mpl0";
    }, NOW);
    expect(result).toEqual({ ok: true, posts: 2 });
    expect(seen).toEqual({ store: "AMAZON", externalId: "B0CM3C9HRG" });
  });
});

describe("relatório do Mercado Livre enviado pela extensão", () => {
  const snapshot = (rangeDays: 7 | 30, clicks: number) => ({
    store: "MERCADO_LIVRE" as const,
    rangeDays,
    periodStart: "2026-09-05T03:00:00.000Z",
    periodEnd: "2026-10-05T03:00:00.000Z",
    clicks,
    buyers: 5,
    orders: 11,
    units: 12,
    salesCents: 203719,
    notEffectiveSalesCents: 0,
    commissionCents: 24297,
  });

  it("guarda um retrato por período e substitui o antigo; formato inválido é recusado", async () => {
    const { reportsPayloadSchema, saveReportSnapshots } = await import("@/lib/store-reports");
    const { tenant } = await seed("rep-ml");
    await saveReportSnapshots(db.prisma, tenant.id, reportsPayloadSchema.parse({ snapshots: [snapshot(7, 40), snapshot(30, 100)] }), NOW);
    await saveReportSnapshots(db.prisma, tenant.id, reportsPayloadSchema.parse({ snapshots: [snapshot(30, 147)] }), NOW);
    const rows = await db.prisma.storeReportSnapshot.findMany({ where: { tenantId: tenant.id }, orderBy: { rangeDays: "asc" } });
    expect(rows.map((r) => [r.rangeDays, r.clicks, r.commissionCents])).toEqual([
      [7, 40, 24297],
      [30, 147, 24297],
    ]);
    expect(reportsPayloadSchema.safeParse({ snapshots: [{ ...snapshot(30, 1), rangeDays: 90 }] }).success).toBe(false);
    expect(reportsPayloadSchema.safeParse({ snapshots: [{ ...snapshot(30, -1) }] }).success).toBe(false);
    // Amazon no mesmo formato (um retrato por loja e período).
    await saveReportSnapshots(db.prisma, tenant.id, reportsPayloadSchema.parse({ snapshots: [{ ...snapshot(30, 64), store: "AMAZON" }] }), NOW);
    expect(await db.prisma.storeReportSnapshot.count({ where: { tenantId: tenant.id } })).toBe(3);
    expect(reportsPayloadSchema.safeParse({ snapshots: [{ ...snapshot(30, 1), store: "SHEIN" }] }).success).toBe(false);
  });
});
