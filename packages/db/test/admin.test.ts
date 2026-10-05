import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { grantAdminPlan, isAdminEmail, parseAdminEmails, syncAdminAccounts } from "../src/admin";
import { assertCanAddWhatsappNumber, assertCanEnableGroupPosting } from "../src/limits";
import { ADMIN_PLAN, PLANS } from "../src/plans";
import { getCurrentSubscription, startTrial } from "../src/subscription";
import { createTestDatabase, type TestDatabase } from "../src/testing";

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.close();
});

let n = 0;
async function account(email: string) {
  const slug = `adm-${++n}`;
  const tenant = await db.prisma.tenant.create({ data: { name: slug, slug } });
  await db.prisma.user.create({ data: { tenantId: tenant.id, email, name: "X", passwordHash: "x", role: "OWNER" } });
  await startTrial(db.prisma, tenant.id);
  return tenant;
}

describe("contas administradoras", () => {
  it("lista de e-mails: separa por vírgula, ignora espaços e maiúsculas", () => {
    expect(parseAdminEmails(" A@x.com, b@y.com ,")).toEqual(["a@x.com", "b@y.com"]);
    expect(isAdminEmail("B@Y.com", "a@x.com,b@y.com")).toBe(true);
    expect(isAdminEmail("c@z.com", "a@x.com,b@y.com")).toBe(false);
    expect(isAdminEmail("a@x.com", undefined)).toBe(false);
  });

  it("plano Administrador: sem limites de plano, relatórios completos, fora da lista pública", () => {
    expect(PLANS.some((p) => p.code === ADMIN_PLAN.code)).toBe(false);
    expect(ADMIN_PLAN).toMatchObject({ active: false, maxGroups: null, aiCaptionsPerMonth: null, reportsLevel: "FULL", priceCents: 0 });
    expect(ADMIN_PLAN.maxWhatsappNumbers).toBeGreaterThanOrEqual(1000);
  });

  it("sync troca o trial pelo plano Administrador (ativo, sem vencer); outras contas não mudam", async () => {
    const admin = await account("dona@exemplo.com");
    const other = await account("cliente@exemplo.com");
    const result = await syncAdminAccounts(db.prisma, "Dona@exemplo.com, ninguem@exemplo.com");
    expect(result).toEqual({ granted: ["dona@exemplo.com"], missing: ["ninguem@exemplo.com"] });

    const sub = await getCurrentSubscription(admin.id, { client: db.prisma, now: new Date("2030-01-01") });
    expect(sub).toMatchObject({ status: "ACTIVE", trialEndsAt: null, plan: { code: "admin", reportsLevel: "FULL" } });
    expect(await db.prisma.subscription.count({ where: { tenantId: admin.id } })).toBe(1);
    expect((await getCurrentSubscription(other.id, { client: db.prisma }))?.plan.code).toBe("starter");

    // Idempotente.
    expect((await syncAdminAccounts(db.prisma, "dona@exemplo.com")).granted).toEqual([]);
  });

  it("limites do plano não barram a conta administradora", async () => {
    const admin = await account("admin2@exemplo.com");
    await grantAdminPlan(db.prisma, admin.id);
    for (let i = 0; i < 5; i++) {
      await db.prisma.channel.create({ data: { tenantId: admin.id, type: "WHATSAPP", name: `W${i}` } });
    }
    await expect(assertCanAddWhatsappNumber(admin.id, { client: db.prisma })).resolves.toBeUndefined();
    await expect(assertCanEnableGroupPosting(admin.id, { client: db.prisma })).resolves.toBeUndefined();
  });
});
