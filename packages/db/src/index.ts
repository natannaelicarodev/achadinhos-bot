import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

// Singleton: evita abrir várias conexões no hot reload do Next.js / tsx watch.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não definida. Copie .env.example para .env.");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export function getPrisma(): PrismaClient {
  globalForPrisma.prisma ??= createClient();
  return globalForPrisma.prisma;
}

export { PrismaClient };
