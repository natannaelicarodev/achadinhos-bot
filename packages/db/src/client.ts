import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export function createPrismaClient(connectionString: string, options: { max?: number } = {}): PrismaClient {
  const adapter = new PrismaPg({ connectionString, ...(options.max ? { max: options.max } : {}) });
  return new PrismaClient({ adapter });
}

// Singleton: evita abrir várias conexões no hot reload do Next.js / tsx watch.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Client SEM escopo de tenant. Use só em operações de sistema
 * (login, cadastro, sessão, seed). Dados de tenant: use `forTenant`.
 */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL não definida. Copie .env.example para .env.");
    }
    globalForPrisma.prisma = createPrismaClient(connectionString);
  }
  return globalForPrisma.prisma;
}
