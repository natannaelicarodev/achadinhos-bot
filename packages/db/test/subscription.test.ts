import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCurrentSubscription, markExpiredTrialsPastDue, startTrial } from "../src/subscription";
import { createTestDatabase, type TestDatabase } from "../src/testing";

let db: TestDatabase;
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.close();
});

async function newTenant(slug: string) {
  return db.prisma.tenant.create({ data: { name: slug, slug } });
}

describe("planos (seed)", () => {
  it("tem Iniciante, Pro e Agência com os preços e limites certos", async () => {
    const plans = await db.prisma.plan.findMany({ orderBy: { priceCents: "asc" } });
    expect(plans.map((p) => [p.code, p.priceCents, p.maxGroups, p.maxPostsPerDay, p.maxUsers, p.reportsLevel])).toEqual([
      ["starter", 7990, 10, 40, 1, "BASIC"],
      ["pro", 14990, 50, 150, 1, "GROUPS"],
      ["agency", 29700, null, 500, 5, "FULL"],
    ]);
  });
});

describe("trial", () => {
  it("cadastro cria TRIALING de 7 dias no plano Iniciante", async () => {
    const tenant = await newTenant("trial-novo");
    const now = new Date("2026-10-01T12:00:00Z");
    await startTrial(db.prisma, tenant.id, now);

    const sub = await getCurrentSubscription(tenant.id, { client: db.prisma, now });
    expect(sub?.status).toBe("TRIALING");
    expect(sub?.plan.code).toBe("starter");
    expect(sub?.trialEndsAt?.getTime()).toBe(now.getTime() + 7 * DAY);
  });

  it("trial vencido vira PAST_DUE ao consultar (e fica salvo)", async () => {
    const tenant = await newTenant("trial-vencido");
    const start = new Date("2026-10-01T12:00:00Z");
    await startTrial(db.prisma, tenant.id, start);

    const later = new Date(start.getTime() + 7 * DAY + 1000);
    const sub = await getCurrentSubscription(tenant.id, { client: db.prisma, now: later });
    expect(sub?.status).toBe("PAST_DUE");

    const stored = await db.prisma.subscription.findFirstOrThrow({ where: { tenantId: tenant.id } });
    expect(stored.status).toBe("PAST_DUE");
  });

  it("markExpiredTrialsPastDue atualiza só trials vencidos", async () => {
    const vencido = await newTenant("lote-vencido");
    const valido = await newTenant("lote-valido");
    const now = new Date("2026-11-01T00:00:00Z");
    await startTrial(db.prisma, vencido.id, new Date(now.getTime() - 8 * DAY));
    await startTrial(db.prisma, valido.id, new Date(now.getTime() - 1 * DAY));

    await markExpiredTrialsPastDue(db.prisma, now);

    const subs = await db.prisma.subscription.findMany({
      where: { tenantId: { in: [vencido.id, valido.id] } },
    });
    const byTenant = Object.fromEntries(subs.map((s) => [s.tenantId, s.status]));
    expect(byTenant[vencido.id]).toBe("PAST_DUE");
    expect(byTenant[valido.id]).toBe("TRIALING");
  });
});
