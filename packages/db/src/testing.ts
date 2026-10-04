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
