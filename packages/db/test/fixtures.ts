import { randomBytes } from "node:crypto";
import type { PrismaClient } from "../src/generated/prisma/client";
import { saveStoreCredential } from "../src/store-credentials";
import { startTrial } from "../src/subscription";

export const TEST_KEY = randomBytes(32);

/** Cria um tenant com um registro em cada model (via client sem escopo). */
export async function seedTenant(prisma: PrismaClient, name: string) {
  const slug = name.toLowerCase();
  const tenant = await prisma.tenant.create({ data: { name, slug } });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, email: `${slug}@teste.com`, name, passwordHash: "x", role: "OWNER" },
  });
  const subscription = await startTrial(prisma, tenant.id);
  const channel = await prisma.channel.create({
    data: { tenantId: tenant.id, type: "TELEGRAM", name: `Canal ${name}` },
  });
  const group = await prisma.group.create({
    data: { tenantId: tenant.id, channelId: channel.id, externalId: `chat-${slug}`, name: `Grupo ${name}` },
  });
  const offer = await prisma.offer.create({
    data: {
      tenantId: tenant.id,
      store: "AMAZON",
      externalId: `B0-${slug}`,
      title: `Oferta ${name}`,
      url: `https://loja.com/${slug}`,
      priceCents: name === "A" ? 1000 : 5000,
      status: "ACTIVE",
    },
  });
  const post = await prisma.post.create({
    data: { tenantId: tenant.id, offerId: offer.id, groupId: group.id, shortCode: `sc-${slug}` },
  });
  const click = await prisma.click.create({
    data: { tenantId: tenant.id, offerId: offer.id, postId: post.id },
  });
  const conversion = await prisma.conversion.create({
    data: {
      tenantId: tenant.id,
      store: "AMAZON",
      externalOrderId: `pedido-${slug}`,
      offerId: offer.id,
      clickId: click.id,
      amountCents: 10000,
      commissionCents: 500,
      occurredAt: new Date(),
    },
  });
  const credential = await saveStoreCredential(
    tenant.id,
    { store: "AMAZON", label: `Amazon ${name}`, secrets: { accessKey: `chave-${slug}-1234` } },
    { client: prisma, key: TEST_KEY },
  );

  const blob = { ciphertext: new Uint8Array([1]), iv: new Uint8Array(12), authTag: new Uint8Array(16) };
  const waSession = await prisma.whatsAppSession.create({
    data: { tenantId: tenant.id, channelId: channel.id, ...blob },
  });
  const waKey = await prisma.whatsAppSessionKey.create({
    data: { tenantId: tenant.id, channelId: channel.id, type: "pre-key", keyId: "1", ...blob },
  });

  const featureRequest = await prisma.featureRequest.create({
    data: { tenantId: tenant.id, userId: user.id, feature: "telegram" },
  });
  const catalogProduct = await prisma.catalogProduct.create({
    data: {
      store: "SHOPEE",
      externalId: `cat-${slug}`,
      title: `Produto ${name}`,
      searchText: `produto ${slug}`,
      productUrl: `https://shopee.com.br/product/1/${slug}`,
      priceCents: 1000,
      lastSeenAt: new Date(),
    },
  });
  const favorite = await prisma.favorite.create({
    data: { tenantId: tenant.id, catalogProductId: catalogProduct.id },
  });
  const messageTemplate = await prisma.messageTemplate.create({
    data: { tenantId: tenant.id, body: `Modelo ${name} {link}`, headline: `Headline ${name}` },
  });
  const autopilot = await prisma.autopilotSettings.create({ data: { tenantId: tenant.id, enabled: true } });
  const extensionToken = await prisma.extensionToken.create({
    data: { tenantId: tenant.id, userId: user.id, tokenHash: `hash-${slug}` },
  });

  return {
    tenant,
    user,
    subscription,
    channel,
    group,
    offer,
    post,
    click,
    conversion,
    credential,
    waSession,
    waKey,
    featureRequest,
    catalogProduct,
    favorite,
    messageTemplate,
    autopilot,
    extensionToken,
  };
}

export type SeededTenant = Awaited<ReturnType<typeof seedTenant>>;
