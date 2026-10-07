// Banco Postgres em memória (PGlite) para testes. Sem Docker, sem rede externa.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "./generated/prisma/client";
import { PLANS } from "./plans";

const migrationsDir = fileURLToPath(new URL("../prisma/migrations", import.meta.url));

export interface TestDatabase {
  prisma: PrismaClient;
  close: () => Promise<void>;
}

export async function createTestDatabase(options: { seedPlans?: boolean } = {}): Promise<TestDatabase> {
  const pglite = await PGlite.create();

  // Aplica as migrations na ordem (mesmo SQL que vai para produção).
  const migrations = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of migrations) {
    await pglite.exec(readFileSync(`${migrationsDir}/${name}/migration.sql`, "utf8"));
  }

  // Adapter direto (em processo). O pglite-socket derruba a conexão após
  // erros de constraint, o que quebraria os testes de FK.
  const prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) });

  if (options.seedPlans ?? true) {
    for (const plan of PLANS) {
      await prisma.plan.create({ data: plan });
    }
  }

  return {
    prisma,
    close: async () => {
      await prisma.$disconnect();
      await pglite.close();
    },
  };
}

/**
 * Testes: deixa a conta num plano PAGO (assinatura ativa + direito de uso como se a cobrança
 * tivesse sido paga). Só para testes: no sistema, direito de uso só nasce de pagamento conferido.
 */
export async function grantTestPlan(
  prisma: PrismaClient,
  tenantId: string,
  planId: string,
  period: { start: Date; end: Date } = { start: new Date(Date.now() - 86_400_000), end: new Date(Date.now() + 365 * 86_400_000) },
) {
  const current = await prisma.subscription.findFirst({ where: { tenantId, status: { not: "CANCELED" } }, orderBy: { createdAt: "desc" } });
  const data = { planId, status: "ACTIVE" as const, trialEndsAt: null, currentPeriodStart: period.start, currentPeriodEnd: period.end };
  if (current) await prisma.subscription.update({ where: { id: current.id }, data });
  else await prisma.subscription.create({ data: { tenantId, ...data } });
  await prisma.entitlement.updateMany({ where: { tenantId, revokedAt: null }, data: { revokedAt: period.start, revokeReason: "teste" } });
  await prisma.entitlement.create({ data: { tenantId, planId, source: "PAYMENT", startsAt: period.start, endsAt: period.end, asaasPaymentId: `test_${tenantId}_${planId}` } });
}
