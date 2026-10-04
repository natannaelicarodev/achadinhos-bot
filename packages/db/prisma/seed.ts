// Seed: planos (idempotente). Rode com `pnpm db:seed`.
import { getPrisma } from "../src/client";
import { PLANS } from "../src/plans";

async function main() {
  const prisma = getPrisma();
  for (const plan of PLANS) {
    await prisma.plan.upsert({ where: { code: plan.code }, create: plan, update: plan });
    console.log(`[seed] plano ${plan.code} ok`);
  }
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
