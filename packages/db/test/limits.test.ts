import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertCanAddWhatsappNumber,
  assertCanEnableGroupPosting,
  assertChannelWithinWhatsappLimit,
  getWhatsappUsage,
  PlanLimitError,
} from "../src/limits";
import { startTrial } from "../src/subscription";
import { createTestDatabase, type TestDatabase } from "../src/testing";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.close();
});

async function tenantOnPlan(slug: string, planCode: string) {
  const tenant = await db.prisma.tenant.create({ data: { name: slug, slug } });
  const sub = await startTrial(db.prisma, tenant.id);
  const plan = await db.prisma.plan.findUniqueOrThrow({ where: { code: planCode } });
  await db.prisma.subscription.update({ where: { id: sub.id }, data: { planId: plan.id, status: "ACTIVE" } });
  return tenant;
}

function addWhatsapp(tenantId: string, name: string, createdAt?: Date) {
  return db.prisma.channel.create({
    data: { tenantId, type: "WHATSAPP", name, ...(createdAt ? { createdAt } : {}) },
  });
}

const opts = () => ({ client: db.prisma });

describe("limite de números de WhatsApp", () => {
  it("Iniciante: 1 número; o segundo é recusado com mensagem em pt-BR", async () => {
    const t = await tenantOnPlan("lim-starter", "starter");
    await assertCanAddWhatsappNumber(t.id, opts());
    await addWhatsapp(t.id, "WhatsApp 1");

    await expect(assertCanAddWhatsappNumber(t.id, opts())).rejects.toThrow(PlanLimitError);
    await expect(assertCanAddWhatsappNumber(t.id, opts())).rejects.toThrow(/1 número de WhatsApp/);
    expect(await getWhatsappUsage(t.id, opts())).toEqual({ used: 1, max: 1 });
  });

  it("canais do Telegram não contam no limite de WhatsApp", async () => {
    const t = await tenantOnPlan("lim-telegram", "starter");
    await db.prisma.channel.create({ data: { tenantId: t.id, type: "TELEGRAM", name: "Bot" } });
    await assertCanAddWhatsappNumber(t.id, opts());
  });

  it("Pro: 3 números", async () => {
    const t = await tenantOnPlan("lim-pro", "pro");
    for (let i = 1; i <= 3; i++) {
      await assertCanAddWhatsappNumber(t.id, opts());
      await addWhatsapp(t.id, `WhatsApp ${i}`);
    }
    await expect(assertCanAddWhatsappNumber(t.id, opts())).rejects.toThrow(/3 números/);
  });

  it("reconectar número existente dentro do limite é permitido; o excedente (downgrade) não", async () => {
    const t = await tenantOnPlan("lim-downgrade", "starter");
    const first = await addWhatsapp(t.id, "Antigo", new Date("2026-01-01"));
    const second = await addWhatsapp(t.id, "Novo", new Date("2026-02-01"));
    await assertChannelWithinWhatsappLimit(t.id, first.id, opts());
    await expect(assertChannelWithinWhatsappLimit(t.id, second.id, opts())).rejects.toThrow(PlanLimitError);
  });
});

describe("limite de grupos com postagem", () => {
  it("Iniciante: até 10 grupos marcados", async () => {
    const t = await tenantOnPlan("lim-grupos", "starter");
    const channel = await addWhatsapp(t.id, "WhatsApp");
    for (let i = 0; i < 10; i++) {
      await assertCanEnableGroupPosting(t.id, opts());
      await db.prisma.group.create({
        data: { tenantId: t.id, channelId: channel.id, externalId: `g${i}@g.us`, name: `G${i}`, postingEnabled: true },
      });
    }
    await expect(assertCanEnableGroupPosting(t.id, opts())).rejects.toThrow(/até 10 grupos/);
  });

  it("Agência: grupos ilimitados (maxGroups null)", async () => {
    const t = await tenantOnPlan("lim-agencia", "agency");
    const channel = await addWhatsapp(t.id, "WhatsApp");
    await db.prisma.group.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        tenantId: t.id,
        channelId: channel.id,
        externalId: `a${i}@g.us`,
        name: `A${i}`,
        postingEnabled: true,
      })),
    });
    await assertCanEnableGroupPosting(t.id, opts());
  });
});
