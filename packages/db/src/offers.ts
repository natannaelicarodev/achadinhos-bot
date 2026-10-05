// Ofertas do tenant: o que ele decidiu divulgar.
import type { PrismaClient, Store } from "./generated/prisma/client";
import { forTenant } from "./tenant";

export interface OfferForSending {
  catalogProductId?: string | null;
  store: Store;
  externalId: string;
  title: string;
  url: string; // link limpo do produto
  affiliateUrl: string; // link de afiliado DO CLIENTE
  imageUrl: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
  commissionCents?: number | null;
  messageText: string;
}

/**
 * "Enviar para meus grupos": grava (ou atualiza) a oferta com link e mensagem
 * prontos e marca o pedido de envio. Quem envia aos grupos é a fila da fase 5.
 * Uma oferta por produto do catálogo; links colados reaproveitam a oferta do
 * mesmo produto (loja + id) que não veio do catálogo.
 */
export async function saveOfferForSending(
  tenantId: string,
  input: OfferForSending,
  options: { client?: PrismaClient; now?: Date } = {},
) {
  const db = forTenant(tenantId, options.client);
  const now = options.now ?? new Date();
  const data = {
    store: input.store,
    externalId: input.externalId,
    title: input.title,
    url: input.url,
    affiliateUrl: input.affiliateUrl,
    imageUrl: input.imageUrl,
    priceCents: input.priceCents,
    originalPriceCents: input.originalPriceCents,
    commissionCents: input.commissionCents ?? null,
    messageText: input.messageText,
    status: "ACTIVE" as const,
    sendRequestedAt: now,
    sendQueuedAt: null, // novo pedido: a fila cria os posts de novo
  };

  if (input.catalogProductId) {
    return db.offer.upsert({
      where: { tenantId_catalogProductId: { tenantId, catalogProductId: input.catalogProductId } },
      create: { tenantId, catalogProductId: input.catalogProductId, ...data },
      update: data,
    });
  }
  const existing = await db.offer.findFirst({
    where: { store: input.store, externalId: input.externalId, catalogProductId: null },
    orderBy: { createdAt: "desc" },
  });
  return existing
    ? db.offer.update({ where: { id: existing.id }, data })
    : db.offer.create({ data: { tenantId, ...data } });
}
