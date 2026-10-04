"use server";

import { featureCodeSchema, requestFeature } from "@achadinhos/db";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/current";

export type FeatureRequestResult = { ok: true; requestedAt: string } | { ok: false; error: string };

/** "Quero usar o Telegram" e futuros pedidos de interesse. Um voto por tenant. */
export async function requestFeatureAction(feature: string): Promise<FeatureRequestResult> {
  const { user } = await requireSession();
  const code = featureCodeSchema.safeParse(feature);
  if (!code.success) return { ok: false, error: "Recurso desconhecido." };

  const { requestedAt } = await requestFeature(user.tenantId, user.id, code.data);
  revalidatePath("/painel/canais");
  return { ok: true, requestedAt: requestedAt.toISOString() };
}
