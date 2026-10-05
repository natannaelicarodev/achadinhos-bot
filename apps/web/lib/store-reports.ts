// Relatórios das lojas lidos pela extensão do CLIENTE (Mercado Livre: painel de afiliados;
// Amazon: Relatórios do Associados).
// Guarda o último retrato por loja e período (7 e 30 dias).
import { forTenant, type PrismaClient } from "@achadinhos/db";
import { z } from "zod";

const count = z.number().int().min(0).max(100_000_000);
const money = z.number().int().min(0).max(10_000_000_000);

export const reportsPayloadSchema = z.object({
  snapshots: z
    .array(
      z.object({
        store: z.enum(["MERCADO_LIVRE", "AMAZON"]),
        rangeDays: z.union([z.literal(7), z.literal(30)]),
        periodStart: z.iso.datetime(),
        periodEnd: z.iso.datetime(),
        clicks: count,
        buyers: count,
        orders: count,
        units: count,
        salesCents: money,
        notEffectiveSalesCents: money,
        commissionCents: money,
      }),
    )
    .min(1)
    .max(4),
});

export async function saveReportSnapshots(
  prisma: PrismaClient,
  tenantId: string,
  payload: z.infer<typeof reportsPayloadSchema>,
  now: Date,
): Promise<number> {
  const db = forTenant(tenantId, prisma);
  for (const s of payload.snapshots) {
    const data = {
      periodStart: new Date(s.periodStart),
      periodEnd: new Date(s.periodEnd),
      clicks: s.clicks,
      buyers: s.buyers,
      orders: s.orders,
      units: s.units,
      salesCents: s.salesCents,
      notEffectiveSalesCents: s.notEffectiveSalesCents,
      commissionCents: s.commissionCents,
      fetchedAt: now,
    };
    await db.storeReportSnapshot.upsert({
      where: { tenantId_store_rangeDays: { tenantId, store: s.store, rangeDays: s.rangeDays } },
      create: { tenantId, store: s.store, rangeDays: s.rangeDays, ...data },
      update: data,
    });
  }
  return payload.snapshots.length;
}
