import { randomBytes } from "node:crypto";
import { startTrial, type PrismaClient } from "@achadinhos/db";
import { grantTestPlan } from "@achadinhos/db/testing";
import { pino } from "pino";

export const SESSION_KEY = randomBytes(32);
export const silentLogger = pino({ level: "silent" });

export async function createTenantWithChannel(prisma: PrismaClient, slug: string) {
  const tenant = await prisma.tenant.create({ data: { name: slug, slug } });
  await startTrial(prisma, tenant.id);
  // Plano pago com período largo (os testes usam relógio fixo).
  const starter = await prisma.plan.findUniqueOrThrow({ where: { code: "starter" } });
  await grantTestPlan(prisma, tenant.id, starter.id, { start: new Date(0), end: new Date("2100-01-01T00:00:00Z") });
  const channel = await prisma.channel.create({
    data: { tenantId: tenant.id, type: "WHATSAPP", name: "WhatsApp 1", status: "CONNECTED" },
  });
  return { tenant, channel };
}
