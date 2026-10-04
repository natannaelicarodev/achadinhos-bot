// Pedidos de interesse em recursos futuros ("Quero usar o Telegram"). Um voto por tenant.
import { z } from "zod";
import { Prisma, type PrismaClient } from "./generated/prisma/client";
import { forTenant } from "./tenant";

/** Códigos aceitos em FeatureRequest.feature. Novo pedido = novo código aqui. */
export const FEATURE_CODES = ["telegram"] as const;
export const featureCodeSchema = z.enum(FEATURE_CODES);
export type FeatureCode = z.infer<typeof featureCodeSchema>;

interface Options {
  client?: PrismaClient;
}

/** Registra o interesse. `created: false` se o tenant já tinha pedido (não duplica). */
export async function requestFeature(
  tenantId: string,
  userId: string,
  feature: FeatureCode,
  options: Options = {},
): Promise<{ created: boolean; requestedAt: Date }> {
  const db = forTenant(tenantId, options.client);
  const code = featureCodeSchema.parse(feature);
  try {
    const row = await db.featureRequest.create({ data: { tenantId, userId, feature: code } });
    return { created: true, requestedAt: row.createdAt };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.featureRequest.findFirstOrThrow({ where: { feature: code } });
      return { created: false, requestedAt: existing.createdAt };
    }
    throw error;
  }
}

/** Data do pedido do tenant para o recurso, ou null se ainda não pediu. */
export async function getFeatureRequest(tenantId: string, feature: FeatureCode, options: Options = {}) {
  return forTenant(tenantId, options.client).featureRequest.findFirst({
    where: { feature: featureCodeSchema.parse(feature) },
    select: { createdAt: true, userId: true },
  });
}
