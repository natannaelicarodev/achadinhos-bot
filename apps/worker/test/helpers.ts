import { randomBytes } from "node:crypto";
import { startTrial, type PrismaClient } from "@achadinhos/db";
import { pino } from "pino";

export const SESSION_KEY = randomBytes(32);
export const silentLogger = pino({ level: "silent" });

export async function createTenantWithChannel(prisma: PrismaClient, slug: string) {
  const tenant = await prisma.tenant.create({ data: { name: slug, slug } });
  await startTrial(prisma, tenant.id);
  const channel = await prisma.channel.create({
    data: { tenantId: tenant.id, type: "WHATSAPP", name: "WhatsApp 1", status: "CONNECTED" },
  });
  return { tenant, channel };
}
