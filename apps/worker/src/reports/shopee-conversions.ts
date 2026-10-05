// Vendas da Shopee por grupo (fase 6): de hora em hora, o relatório de conversões de cada
// cliente (credencial DELE) vira linhas de Conversion ligadas ao grupo pelos subIds do link.
import { forTenant, getStoreCredentialSecrets, type PrismaClient } from "@achadinhos/db";
import { ShopeeReportReader, shopeeSecretsSchema, type ShopeeOrderConversion } from "@achadinhos/stores";
import type { Logger } from "pino";

/** Janela buscada a cada rodada: vendas do mês e mudança de status (pendente -> concluída leva semanas). */
export const SHOPEE_REPORT_LOOKBACK_MS = 35 * 24 * 60 * 60_000;

export interface ConversionsReader {
  conversions(start: Date, end: Date): Promise<ShopeeOrderConversion[]>;
}

/**
 * Grava as vendas de UM cliente. O 1º subId tem que ser o próprio cliente (link gerado por
 * nós); o 2º só vira grupo se for um grupo DELE. Venda já gravada só é atualizada.
 */
export async function saveShopeeConversions(
  prisma: PrismaClient,
  tenantId: string,
  rows: ShopeeOrderConversion[],
): Promise<{ saved: number; withGroup: number }> {
  const db = forTenant(tenantId, prisma);
  const candidateGroups = [...new Set(rows.filter((r) => r.subIds[0] === tenantId).map((r) => r.subIds[1]).filter(Boolean))] as string[];
  const ownGroups = new Set(
    (await db.group.findMany({ where: { id: { in: candidateGroups } }, select: { id: true } })).map((g) => g.id),
  );
  const itemIds = [...new Set(rows.map((r) => r.itemId).filter(Boolean))] as string[];
  const offers = await db.offer.findMany({
    where: { store: "SHOPEE", externalId: { in: itemIds } },
    select: { id: true, externalId: true },
    orderBy: { createdAt: "desc" },
  });
  const offerByItem = new Map<string, string>();
  for (const o of offers) if (o.externalId && !offerByItem.has(o.externalId)) offerByItem.set(o.externalId, o.id);

  let withGroup = 0;
  for (const row of rows) {
    const fromUs = row.subIds[0] === tenantId;
    const groupId = fromUs && row.subIds[1] && ownGroups.has(row.subIds[1]) ? row.subIds[1] : null;
    if (groupId) withGroup++;
    const data = {
      amountCents: row.amountCents,
      commissionCents: row.commissionCents,
      occurredAt: row.purchasedAt,
      clickedAt: row.clickedAt,
      status: row.status,
      groupId,
      offerId: row.itemId ? (offerByItem.get(row.itemId) ?? null) : null,
    };
    await db.conversion.upsert({
      where: { tenantId_store_externalOrderId: { tenantId, store: "SHOPEE", externalOrderId: row.orderId } },
      create: { tenantId, store: "SHOPEE", externalOrderId: row.orderId, ...data },
      update: data,
    });
  }
  return { saved: rows.length, withGroup };
}

/** Todos os clientes com credencial da Shopee. Falha de um cliente não para os outros. */
export async function syncShopeeConversions(
  deps: {
    prisma: PrismaClient;
    logger?: Logger;
    readerFor?: (secrets: { appId: string; apiSecret: string }) => ConversionsReader;
  },
  now: Date = new Date(),
) {
  const credentials = await deps.prisma.storeCredential.findMany({ where: { store: "SHOPEE" }, select: { tenantId: true } });
  const results: { tenantId: string; saved?: number; error?: string }[] = [];
  for (const { tenantId } of credentials) {
    try {
      const parsed = shopeeSecretsSchema.safeParse(await getStoreCredentialSecrets(tenantId, "SHOPEE", { client: deps.prisma }));
      if (!parsed.success) continue;
      const reader =
        deps.readerFor?.(parsed.data) ?? new ShopeeReportReader({ appId: parsed.data.appId, secret: parsed.data.apiSecret });
      const rows = await reader.conversions(new Date(now.getTime() - SHOPEE_REPORT_LOOKBACK_MS), now);
      const { saved, withGroup } = await saveShopeeConversions(deps.prisma, tenantId, rows);
      if (saved > 0) deps.logger?.info({ tenantId, saved, withGroup }, "[relatórios] vendas da Shopee atualizadas");
      results.push({ tenantId, saved });
    } catch (error) {
      deps.logger?.warn({ tenantId, err: error }, "[relatórios] falha ao ler vendas da Shopee");
      results.push({ tenantId, error: error instanceof Error ? error.message : "erro" });
    }
  }
  return results;
}
