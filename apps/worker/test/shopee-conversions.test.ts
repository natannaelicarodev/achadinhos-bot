import { createTestDatabase, type TestDatabase } from "@achadinhos/db/testing";
import type { ShopeeOrderConversion } from "@achadinhos/stores";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveShopeeConversions } from "../src/reports/shopee-conversions";

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.close();
});

async function tenantWithGroup(slug: string) {
  const prisma = db.prisma;
  const tenant = await prisma.tenant.create({ data: { name: slug, slug } });
  const channel = await prisma.channel.create({ data: { tenantId: tenant.id, type: "WHATSAPP", name: "W" } });
  const group = await prisma.group.create({ data: { tenantId: tenant.id, channelId: channel.id, externalId: `${slug}@g.us`, name: "Grupo" } });
  return { tenant, group };
}

const row = (orderId: string, subIds: string[], extra: Partial<ShopeeOrderConversion> = {}): ShopeeOrderConversion => ({
  orderId,
  conversionId: "1",
  subIds,
  status: "PENDING",
  purchasedAt: new Date("2026-10-05T15:00:00Z"),
  clickedAt: new Date("2026-10-05T14:50:00Z"),
  itemId: "22334455",
  amountCents: 5990,
  commissionCents: 479,
  ...extra,
});

describe("vendas da Shopee por grupo", () => {
  it("liga ao grupo pelos subIds [cliente, grupo]; venda de fora fica sem grupo; liga à oferta pelo produto", async () => {
    const { tenant, group } = await tenantWithGroup("conv-a");
    const offer = await db.prisma.offer.create({
      data: { tenantId: tenant.id, store: "SHOPEE", externalId: "22334455", title: "Produto", url: "https://shopee.com.br/x" },
    });
    const result = await saveShopeeConversions(db.prisma, tenant.id, [
      row("P1", [tenant.id, group.id]),
      row("P2", []), // link divulgado por fora do sistema
    ]);
    expect(result).toEqual({ saved: 2, withGroup: 1 });
    const rows = await db.prisma.conversion.findMany({ where: { tenantId: tenant.id }, orderBy: { externalOrderId: "asc" } });
    expect(rows.map((c) => [c.externalOrderId, c.groupId, c.offerId, c.amountCents, c.commissionCents, c.status])).toEqual([
      ["P1", group.id, offer.id, 5990, 479, "PENDING"],
      ["P2", null, offer.id, 5990, 479, "PENDING"],
    ]);
  });

  it("subIds de outro cliente ou grupo de outro cliente nunca entram como grupo", async () => {
    const a = await tenantWithGroup("conv-b1");
    const b = await tenantWithGroup("conv-b2");
    await saveShopeeConversions(db.prisma, a.tenant.id, [
      row("Q1", [b.tenant.id, b.group.id]), // link de outro cliente
      row("Q2", [a.tenant.id, b.group.id]), // grupo que não é do cliente
    ]);
    const rows = await db.prisma.conversion.findMany({ where: { tenantId: a.tenant.id } });
    expect(rows.every((c) => c.groupId === null)).toBe(true);
    expect(await db.prisma.conversion.count({ where: { tenantId: b.tenant.id } })).toBe(0);
  });

  it("venda que volta no relatório só é atualizada (ex.: pendente -> concluída)", async () => {
    const { tenant, group } = await tenantWithGroup("conv-c");
    await saveShopeeConversions(db.prisma, tenant.id, [row("R1", [tenant.id, group.id])]);
    await saveShopeeConversions(db.prisma, tenant.id, [row("R1", [tenant.id, group.id], { status: "COMPLETED", commissionCents: 500 })]);
    const rows = await db.prisma.conversion.findMany({ where: { tenantId: tenant.id } });
    expect(rows.map((c) => [c.status, c.commissionCents])).toEqual([["COMPLETED", 500]]);
  });
});
