import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFeatureRequest, requestFeature } from "../src/feature-requests";
import { createTestDatabase, type TestDatabase } from "../src/testing";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.close();
});

async function tenantWithUsers(slug: string) {
  const tenant = await db.prisma.tenant.create({ data: { name: slug, slug } });
  const [owner, member] = await Promise.all(
    ["dono", "membro"].map((name) =>
      db.prisma.user.create({
        data: { tenantId: tenant.id, email: `${name}@${slug}.com`, name, passwordHash: "x" },
      }),
    ),
  );
  return { tenant, owner: owner!, member: member! };
}

const opts = () => ({ client: db.prisma });

describe("pedido de interesse (FeatureRequest)", () => {
  it("salva tenant, usuário e data", async () => {
    const { tenant, owner } = await tenantWithUsers("fr-salva");
    expect(await getFeatureRequest(tenant.id, "telegram", opts())).toBeNull();

    const result = await requestFeature(tenant.id, owner.id, "telegram", opts());
    expect(result.created).toBe(true);

    const row = await db.prisma.featureRequest.findFirstOrThrow({ where: { tenantId: tenant.id } });
    expect(row).toMatchObject({ tenantId: tenant.id, userId: owner.id, feature: "telegram" });
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("mesmo tenant não vota duas vezes (nem com outro usuário)", async () => {
    const { tenant, owner, member } = await tenantWithUsers("fr-duplo");
    const first = await requestFeature(tenant.id, owner.id, "telegram", opts());
    const again = await requestFeature(tenant.id, owner.id, "telegram", opts());
    const other = await requestFeature(tenant.id, member.id, "telegram", opts());

    expect(again).toEqual({ created: false, requestedAt: first.requestedAt });
    expect(other.created).toBe(false);
    expect(await db.prisma.featureRequest.count({ where: { tenantId: tenant.id } })).toBe(1);
  });

  it("tenants diferentes votam separadamente", async () => {
    const a = await tenantWithUsers("fr-a");
    const b = await tenantWithUsers("fr-b");
    await requestFeature(a.tenant.id, a.owner.id, "telegram", opts());
    expect(await getFeatureRequest(b.tenant.id, "telegram", opts())).toBeNull();
    expect((await requestFeature(b.tenant.id, b.owner.id, "telegram", opts())).created).toBe(true);
  });

  it("recusa usuário de outro tenant (FK composta) e código de recurso desconhecido", async () => {
    const a = await tenantWithUsers("fr-fk-a");
    const b = await tenantWithUsers("fr-fk-b");
    await expect(requestFeature(a.tenant.id, b.owner.id, "telegram", opts())).rejects.toMatchObject({
      code: "P2003",
    });
    await expect(requestFeature(a.tenant.id, a.owner.id, "discord" as "telegram", opts())).rejects.toThrow();
  });
});
