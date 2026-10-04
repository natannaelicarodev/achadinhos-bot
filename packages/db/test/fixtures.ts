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

  return { tenant, user, subscription, channel, group, offer, post, click, conversion, credential };
}

export type SeededTenant = Awaited<ReturnType<typeof seedTenant>>;
