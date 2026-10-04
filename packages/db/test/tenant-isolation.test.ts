import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getStoreCredentialSecrets } from "../src/store-credentials";
import { forTenant, TenantScopeError, type TenantDb } from "../src/tenant";
import { createTestDatabase, type TestDatabase } from "../src/testing";
import { seedTenant, TEST_KEY, type SeededTenant } from "./fixtures";

let db: TestDatabase;
let a: SeededTenant;
let b: SeededTenant;
let dbA: TenantDb;

beforeAll(async () => {
  db = await createTestDatabase();
  a = await seedTenant(db.prisma, "A");
  b = await seedTenant(db.prisma, "B");
  dbA = forTenant(a.tenant.id, db.prisma);
});

afterAll(async () => {
  await db?.close();
});

describe("forTenant: leitura", () => {
  it("findMany devolve só registros do próprio tenant, em todos os models", async () => {
    const lists = await Promise.all([
      dbA.user.findMany(),
      dbA.subscription.findMany(),
      dbA.channel.findMany(),
      dbA.group.findMany(),
      dbA.offer.findMany(),
      dbA.post.findMany(),
      dbA.click.findMany(),
      dbA.conversion.findMany(),
      dbA.storeCredential.findMany(),
      dbA.whatsAppSession.findMany(),
      dbA.whatsAppSessionKey.findMany(),
      dbA.featureRequest.findMany(),
      dbA.favorite.findMany(),
    ]);
    for (const rows of lists) {
      expect(rows).toHaveLength(1);
      expect(rows.every((row) => row.tenantId === a.tenant.id)).toBe(true);
    }
  });

  it("findUnique pelo id de registro de outro tenant devolve null", async () => {
    expect(await dbA.user.findUnique({ where: { id: b.user.id } })).toBeNull();
    expect(await dbA.subscription.findUnique({ where: { id: b.subscription.id } })).toBeNull();
    expect(await dbA.channel.findUnique({ where: { id: b.channel.id } })).toBeNull();
    expect(await dbA.group.findUnique({ where: { id: b.group.id } })).toBeNull();
    expect(await dbA.offer.findUnique({ where: { id: b.offer.id } })).toBeNull();
    expect(await dbA.post.findUnique({ where: { id: b.post.id } })).toBeNull();
    expect(await dbA.post.findUnique({ where: { shortCode: b.post.shortCode } })).toBeNull();
    expect(await dbA.click.findUnique({ where: { id: b.click.id } })).toBeNull();
    expect(await dbA.conversion.findUnique({ where: { id: b.conversion.id } })).toBeNull();
    expect(await dbA.storeCredential.findUnique({ where: { id: b.credential.id } })).toBeNull();
    expect(await dbA.user.findUnique({ where: { email: b.user.email } })).toBeNull();
    expect(await dbA.whatsAppSession.findUnique({ where: { channelId: b.channel.id } })).toBeNull();
    expect(
      await dbA.whatsAppSessionKey.findUnique({
        where: { channelId_type_keyId: { channelId: b.channel.id, type: "pre-key", keyId: "1" } },
      }),
    ).toBeNull();
  });

  it("sessão do WhatsApp não pode apontar para canal de outro tenant (FK composta)", async () => {
    await expect(
      db.prisma.whatsAppSessionKey.create({
        data: {
          tenantId: a.tenant.id,
          channelId: b.channel.id,
          type: "session",
          keyId: "x",
          ciphertext: new Uint8Array([1]),
          iv: new Uint8Array(12),
          authTag: new Uint8Array(16),
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("findFirst / findUniqueOrThrow não acham registro de outro tenant", async () => {
    expect(await dbA.offer.findFirst({ where: { id: b.offer.id } })).toBeNull();
    await expect(dbA.offer.findUniqueOrThrow({ where: { id: b.offer.id } })).rejects.toMatchObject({
      code: "P2025",
    });
  });

  it("filtro explícito com tenantId de outro tenant lança erro", async () => {
    await expect(dbA.offer.findMany({ where: { tenantId: b.tenant.id } })).rejects.toBeInstanceOf(
      TenantScopeError,
    );
  });

  it("count, aggregate e groupBy só consideram o próprio tenant", async () => {
    expect(await dbA.offer.count()).toBe(1);
    const agg = await dbA.offer.aggregate({ _sum: { priceCents: true } });
    expect(agg._sum.priceCents).toBe(1000);
    const groups = await dbA.offer.groupBy({ by: ["store"], _count: { _all: true } });
    expect(groups).toEqual([{ store: "AMAZON", _count: { _all: 1 } }]);
  });

  it("include de relações não traz dados de outro tenant", async () => {
    const offers = await dbA.offer.findMany({ include: { posts: true, clicks: true, conversions: true } });
    const nested = offers.flatMap((o) => [...o.posts, ...o.clicks, ...o.conversions]);
    expect(nested.length).toBeGreaterThan(0);
    expect(nested.every((row) => row.tenantId === a.tenant.id)).toBe(true);
  });

  it("model Tenant: só enxerga o próprio tenant", async () => {
    const tenants = await dbA.tenant.findMany();
    expect(tenants.map((t) => t.id)).toEqual([a.tenant.id]);
    await expect(dbA.tenant.findUnique({ where: { id: b.tenant.id } })).rejects.toBeInstanceOf(
      TenantScopeError,
    );
    await expect(dbA.tenant.delete({ where: { id: a.tenant.id } })).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("models de auth ficam bloqueados; Plan é só leitura", async () => {
    await expect(dbA.session.findMany()).rejects.toBeInstanceOf(TenantScopeError);
    await expect(dbA.passwordResetToken.findMany()).rejects.toBeInstanceOf(TenantScopeError);
    expect(await dbA.plan.count()).toBe(3);
    await expect(dbA.plan.updateMany({ data: { priceCents: 0 } })).rejects.toBeInstanceOf(TenantScopeError);
    // Catálogo central: todos leem, ninguém altera pelo client de tenant.
    expect(await dbA.catalogProduct.count()).toBeGreaterThanOrEqual(2);
    await expect(
      dbA.catalogProduct.updateMany({ data: { priceCents: 1 } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(dbA.catalogMiningRun.deleteMany()).rejects.toBeInstanceOf(TenantScopeError);
  });
});

describe("forTenant: escrita", () => {
  it("update em registro de outro tenant falha e não altera nada", async () => {
    await expect(
      dbA.offer.update({ where: { id: b.offer.id }, data: { title: "invadido" } }),
    ).rejects.toMatchObject({ code: "P2025" });
    const offerB = await db.prisma.offer.findUniqueOrThrow({ where: { id: b.offer.id } });
    expect(offerB.title).toBe("Oferta B");
  });

  it("updateMany / deleteMany com id de outro tenant afetam 0 registros", async () => {
    expect((await dbA.offer.updateMany({ where: { id: b.offer.id }, data: { title: "x" } })).count).toBe(0);
    expect((await dbA.conversion.deleteMany({ where: { id: b.conversion.id } })).count).toBe(0);
    expect(await db.prisma.conversion.count({ where: { tenantId: b.tenant.id } })).toBe(1);
  });

  it("delete de registro de outro tenant falha", async () => {
    await expect(dbA.click.delete({ where: { id: b.click.id } })).rejects.toMatchObject({ code: "P2025" });
    expect(await db.prisma.click.count({ where: { tenantId: b.tenant.id } })).toBe(1);
  });

  it("create com tenantId de outro tenant lança TenantScopeError", async () => {
    await expect(
      dbA.channel.create({ data: { tenantId: b.tenant.id, type: "WHATSAPP", name: "intruso" } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      dbA.channel.createMany({ data: [{ tenantId: b.tenant.id, type: "WHATSAPP", name: "intruso" }] }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("create sem tenantId recebe o tenant do client", async () => {
    const channel = await dbA.channel.create({ data: { type: "WHATSAPP", name: "Novo" } as never });
    expect(channel.tenantId).toBe(a.tenant.id);
    await dbA.channel.delete({ where: { id: channel.id } });
  });

  it("update não pode mover registro para outro tenant", async () => {
    await expect(
      dbA.offer.update({ where: { id: a.offer.id }, data: { tenantId: b.tenant.id } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("banco recusa Post ligando oferta do tenant A a grupo do tenant B (FK composta)", async () => {
    await expect(
      dbA.post.create({
        data: { tenantId: a.tenant.id, offerId: a.offer.id, groupId: b.group.id, shortCode: "cruzado" },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    // Mesmo pelo client sem escopo o banco recusa.
    await expect(
      db.prisma.post.create({
        data: { tenantId: a.tenant.id, offerId: a.offer.id, groupId: b.group.id, shortCode: "cruzado2" },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("upsert com id de outro tenant não altera o registro dele", async () => {
    await dbA.channel.upsert({
      where: { id: b.channel.id },
      create: { tenantId: a.tenant.id, type: "TELEGRAM", name: "criado por A" },
      update: { name: "alterado por A" },
    });
    const channelB = await db.prisma.channel.findUniqueOrThrow({ where: { id: b.channel.id } });
    expect(channelB.name).toBe("Canal B");
  });

  it("deleteMany sem filtro apaga só do próprio tenant", async () => {
    await dbA.conversion.deleteMany();
    expect(await db.prisma.conversion.count({ where: { tenantId: a.tenant.id } })).toBe(0);
    expect(await db.prisma.conversion.count({ where: { tenantId: b.tenant.id } })).toBe(1);
  });

  it("tenantId vazio é recusado", () => {
    expect(() => forTenant("", db.prisma)).toThrow(TenantScopeError);
    expect(() => forTenant("   ", db.prisma)).toThrow(TenantScopeError);
  });
});

describe("exclusão de tenant", () => {
  it("apagar um tenant apaga todos os dados dele (cascata) e não toca no outro", async () => {
    const c = await seedTenant(db.prisma, "C");
    await db.prisma.tenant.delete({ where: { id: c.tenant.id } });

    const where = { tenantId: c.tenant.id };
    const counts = await Promise.all([
      db.prisma.user.count({ where }),
      db.prisma.subscription.count({ where }),
      db.prisma.channel.count({ where }),
      db.prisma.group.count({ where }),
      db.prisma.offer.count({ where }),
      db.prisma.post.count({ where }),
      db.prisma.click.count({ where }),
      db.prisma.conversion.count({ where }),
      db.prisma.storeCredential.count({ where }),
      db.prisma.whatsAppSession.count({ where }),
      db.prisma.whatsAppSessionKey.count({ where }),
      db.prisma.featureRequest.count({ where }),
      db.prisma.favorite.count({ where }),
    ]);
    expect(counts.every((n) => n === 0)).toBe(true);
    expect(await db.prisma.offer.count({ where: { tenantId: b.tenant.id } })).toBe(1);
  });
});

describe("StoreCredential entre tenants", () => {
  it("cada tenant lê só a própria credencial", async () => {
    const secretsA = await getStoreCredentialSecrets(a.tenant.id, "AMAZON", { client: db.prisma, key: TEST_KEY });
    expect(secretsA).toEqual({ accessKey: "chave-a-1234" });
  });

  it("ciphertext copiado de B para A não descriptografa (AAD amarra ao tenant)", async () => {
    const rowB = await db.prisma.storeCredential.findUniqueOrThrow({ where: { id: b.credential.id } });
    await db.prisma.storeCredential.update({
      where: { id: a.credential.id },
      data: { ciphertext: rowB.ciphertext, iv: rowB.iv, authTag: rowB.authTag },
    });
    await expect(
      getStoreCredentialSecrets(a.tenant.id, "AMAZON", { client: db.prisma, key: TEST_KEY }),
    ).rejects.toThrow();
  });
});
