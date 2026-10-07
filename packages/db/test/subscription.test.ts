import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCurrentSubscription, markExpiredTrialsPastDue, startTrial } from "../src/subscription";
import { PLANS } from "../src/plans";
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
  it("tem Catálogo, Iniciante, Pro e Agência com os preços e limites certos", async () => {
    const plans = await db.prisma.plan.findMany({ orderBy: { priceCents: "asc" } });
    expect(
      plans.map((p) => [
        p.code,
        p.priceCents,
        p.annualPriceCents,
        p.maxWhatsappNumbers,
        p.maxGroups,
        p.maxPostsPerDay,
        p.maxUsers,
        p.aiEnabled,
        p.aiCaptionsPerMonth,
        p.reportsLevel,
      ]),
    ).toEqual([
      ["catalog", 1990, 19700, 0, 0, 0, 1, false, 0, "BASIC"],
      ["starter", 4700, 46700, 1, 10, 20, 1, true, 300, "BASIC"],
      ["pro", 9700, 96700, 3, 50, 100, 1, true, null, "GROUPS"],
      ["agency", 19700, 196700, 10, null, 500, 5, true, null, "FULL"],
    ]);
  });

  it("seed atualiza os planos que já existem (upsert pelo code) sem apagar assinaturas", async () => {
    const tenant = await newTenant("seed-upsert");
    await startTrial(db.prisma, tenant.id);
    const starter = await db.prisma.plan.update({ where: { code: "starter" }, data: { priceCents: 7990, maxPostsPerDay: 40 } });
    for (const plan of PLANS) await db.prisma.plan.upsert({ where: { code: plan.code }, create: plan, update: plan });
    const after = await db.prisma.plan.findUniqueOrThrow({ where: { code: "starter" } });
    expect([after.id, after.priceCents, after.maxPostsPerDay]).toEqual([starter.id, 4700, 20]);
    expect(await db.prisma.subscription.count({ where: { tenantId: tenant.id, planId: starter.id } })).toBe(1);
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

describe("contas antigas (antes dos direitos de uso)", () => {
  it("teste grátis válido sem registro ganha o direito do teste; vencido não ganha nada", async () => {
    const now = new Date("2026-10-06T12:00:00Z");
    const starter = await db.prisma.plan.findUniqueOrThrow({ where: { code: "starter" } });
    const make = async (slug: string, trialEndsAt: Date) => {
      const tenant = await newTenant(slug);
      await db.prisma.subscription.create({
        data: { tenantId: tenant.id, planId: starter.id, status: "TRIALING", trialEndsAt, currentPeriodStart: now, currentPeriodEnd: trialEndsAt },
      });
      return tenant.id;
    };
    const valid = await make("legado-ok", new Date(now.getTime() + 3 * DAY));
    const expired = await make("legado-vencido", new Date(now.getTime() - DAY));
    expect((await getCurrentSubscription(valid, { client: db.prisma, now }))?.plan.code).toBe("starter");
    expect(await db.prisma.entitlement.count({ where: { tenantId: valid, source: "TRIAL" } })).toBe(1);
    expect((await getCurrentSubscription(expired, { client: db.prisma, now }))?.plan.code).toBe("catalog");
    expect(await db.prisma.entitlement.count({ where: { tenantId: expired } })).toBe(0);
  });
});
