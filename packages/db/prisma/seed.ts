// Seed: planos (idempotente). Rode com `pnpm db:seed`.
import { getPrisma } from "../src/client";
import { syncAdminAccounts, upsertAdminPlan } from "../src/admin";
import { PLANS } from "../src/plans";

async function main() {
  const prisma = getPrisma();
  for (const plan of PLANS) {
    await prisma.plan.upsert({ where: { code: plan.code }, create: plan, update: plan });
    console.log(`[seed] plano ${plan.code} ok`);
  }
  // Contas administradoras (SYSTEM_ADMIN_EMAILS): plano interno "Administrador", sem limites.
  await upsertAdminPlan(prisma);
  const { granted, missing } = await syncAdminAccounts(prisma);
  console.log(`[seed] plano admin ok${granted.length ? `; aplicado a ${granted.join(", ")}` : ""}`);
  if (missing.length) console.log(`[seed] ainda sem cadastro (recebem o plano ao se cadastrar): ${missing.join(", ")}`);
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
