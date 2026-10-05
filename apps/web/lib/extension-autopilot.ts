// Piloto automático + links curtos: a extensão do CLIENTE gera no Chrome dele o meli.la
// (Mercado Livre) e o link.amazon (Amazon, SiteStripe).
// A cada minuto ela chama POST /api/extension/autopilot com a chave dela: dá sinal de vida,
// entrega os links gerados e recebe os próximos produtos que precisam de link.
// O servidor CONFERE cada link (etiqueta do cliente; Amazon também o produto) antes de usar.
import { createHash, randomBytes } from "node:crypto";
import { forTenant, getStoreCredentialSecrets, type PrismaClient } from "@achadinhos/db";
import { amazonSecretsSchema, mercadoLivreSecretsSchema } from "@achadinhos/stores";
import { z } from "zod";

/** Até quantos produtos a extensão recebe por chamada (1 link curto por produto, vale para todos os grupos). */
export const PENDING_PER_CALL = 5;

export const hashExtensionToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newExtensionToken = () => randomBytes(32).toString("base64url");

/** Chave da extensão -> tenant (e marca o sinal de vida). null se a chave não existe. */
export async function authenticateExtension(prisma: PrismaClient, authorization: string | null, now: Date) {
  const token = authorization?.match(/^Bearer\s+([A-Za-z0-9_-]{32,128})$/)?.[1];
  if (!token) return null;
  const row = await prisma.extensionToken.findUnique({
    where: { tokenHash: hashExtensionToken(token) },
    select: { id: true, tenantId: true },
  });
  if (!row) return null;
  await prisma.extensionToken.update({ where: { id: row.id }, data: { lastSeenAt: now } });
  return row;
}

export const autopilotCallSchema = z.object({
  links: z
    .array(z.object({ offerId: z.string().min(1).max(100), shortUrl: z.string().url().max(300) }))
    .max(PENDING_PER_CALL)
    .default([]),
});

export interface PendingLink {
  offerId: string;
  store: "MERCADO_LIVRE" | "AMAZON";
  productUrl: string;
  tag: string;
}

/** Produtos do ML e da Amazon com posts "Aguardando link" (o link sai com a etiqueta do cliente). */
export async function pendingShortLinks(prisma: PrismaClient, tenantId: string): Promise<PendingLink[]> {
  const db = forTenant(tenantId, prisma);
  const [ml, amazon] = await Promise.all([
    getStoreCredentialSecrets(tenantId, "MERCADO_LIVRE", { client: prisma }),
    getStoreCredentialSecrets(tenantId, "AMAZON", { client: prisma }),
  ]);
  const tags: Partial<Record<PendingLink["store"], string>> = {};
  const mlParsed = mercadoLivreSecretsSchema.safeParse(ml);
  if (mlParsed.success) tags.MERCADO_LIVRE = mlParsed.data.mattWord;
  const amazonParsed = amazonSecretsSchema.safeParse(amazon);
  if (amazonParsed.success) tags.AMAZON = amazonParsed.data.tag;
  const stores = Object.keys(tags) as PendingLink["store"][];
  if (stores.length === 0) return [];
  const posts = await db.post.findMany({
    where: { status: "AWAITING_LINK", store: { in: stores } },
    select: { offerId: true, store: true, offer: { select: { url: true } } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  const unique = new Map<string, PendingLink>();
  for (const p of posts) {
    const store = p.store as PendingLink["store"];
    const tag = tags[store];
    if (tag && !unique.has(p.offerId)) unique.set(p.offerId, { offerId: p.offerId, store, productUrl: p.offer.url, tag });
  }
  return [...unique.values()].slice(0, PENDING_PER_CALL);
}

/**
 * Coloca o link curto nos posts da oferta que estavam esperando: troca o link longo pelo
 * curto no texto e libera para envio. `verify` confere que o link é do cliente (e do
 * produto da oferta) e devolve o link limpo (ou null).
 */
export async function applyShortLink(
  prisma: PrismaClient,
  tenantId: string,
  input: { offerId: string; shortUrl: string },
  verify: (shortUrl: string, offer: { store: string; externalId: string | null }) => Promise<string | null>,
  now: Date,
): Promise<{ ok: boolean; posts: number }> {
  const db = forTenant(tenantId, prisma);
  const posts = await db.post.findMany({
    where: { offerId: input.offerId, status: "AWAITING_LINK" },
    select: { id: true, messageText: true, affiliateUrl: true, offer: { select: { store: true, externalId: true } } },
  });
  const offer = posts[0]?.offer;
  if (!offer) return { ok: false, posts: 0 };
  const link = await verify(input.shortUrl, offer);
  if (!link) return { ok: false, posts: 0 };
  for (const post of posts) {
    const text = post.messageText && post.affiliateUrl ? post.messageText.split(post.affiliateUrl).join(link) : post.messageText;
    // Só muda se ainda estiver esperando (o post pode ter sido descartado nesse meio tempo).
    await db.post.updateMany({
      where: { id: post.id, status: "AWAITING_LINK" },
      data: { status: "SCHEDULED", scheduledAt: now, affiliateUrl: link, messageText: text },
    });
  }
  return { ok: true, posts: posts.length };
}
