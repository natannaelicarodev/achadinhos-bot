"use server";

import { forTenant, saveOfferForSending } from "@achadinhos/db";
import {
  parseHttpsUrl,
  parseProductUrl,
  resolveStoreUrl,
  StoreUrlError,
  type AffiliateStore,
  type PageProductInfo,
  type ProductRef,
} from "@achadinhos/stores";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/current";
import {
  affiliateLinkFor,
  composeMessage,
  getMessageSettings,
  readProductInfo,
  type MessageSettings,
} from "@/lib/affiliate-server";

export interface SharePreview {
  product: ProductRef;
  catalogProductId: string | null;
  info: PageProductInfo & { discountPct: number | null };
  /** true se não deu para ler os dados da página: o cliente preenche. */
  needsManualInfo: boolean;
  link: string | null;
  linkError: string | null;
  missingCredential: AffiliateStore | null;
  settings: MessageSettings;
}

export type PreviewResult = { ok: true; preview: SharePreview } | { ok: false; error: string };

/** "Divulgar link": identifica a loja, converte com a credencial do cliente e lê os dados do produto. */
export async function previewPastedLinkAction(rawUrl: string): Promise<PreviewResult> {
  const { user } = await requireSession();
  const input = z.string().trim().min(8).max(2048).safeParse(rawUrl);
  if (!input.success || !parseHttpsUrl(input.data)) return { ok: false, error: "Cole um endereço válido (começando com https://)." };

  let product: ProductRef | null = null;
  try {
    const first = parseHttpsUrl(input.data)!;
    product = parseProductUrl(first);
    if (!product) {
      const chain = await resolveStoreUrl(input.data);
      product = chain.map(parseProductUrl).findLast((p) => p !== null) ?? null;
    }
  } catch (error) {
    if (error instanceof StoreUrlError) return { ok: false, error: error.message };
    throw error;
  }
  if (!product) {
    return { ok: false, error: "Não encontrei um produto nesse endereço. Abra a página do produto na loja e copie o link de lá." };
  }

  const [link, info, settings] = await Promise.all([
    affiliateLinkFor(user.tenantId, product),
    readProductInfo(product),
    getMessageSettings(user.tenantId),
  ]);
  return {
    ok: true,
    preview: {
      product,
      catalogProductId: null,
      info: {
        title: info?.title ?? null,
        imageUrl: info?.imageUrl ?? null,
        priceCents: info?.priceCents ?? null,
        originalPriceCents: info?.originalPriceCents ?? null,
        discountPct: null,
      },
      needsManualInfo: !info?.title || !info.priceCents,
      link: link.ok ? link.link : null,
      linkError: link.ok ? null : link.error,
      missingCredential: link.ok ? null : (link.missingCredential ?? null),
      settings,
    },
  };
}

/** Catálogo: link do cliente para um produto do catálogo central. */
export async function previewCatalogProductAction(catalogProductId: string): Promise<PreviewResult> {
  const { user } = await requireSession();
  const id = z.string().min(1).max(100).safeParse(catalogProductId);
  if (!id.success) return { ok: false, error: "Produto não encontrado." };
  const row = await forTenant(user.tenantId).catalogProduct.findUnique({ where: { id: id.data } });
  if (!row || !row.active) return { ok: false, error: "Este produto saiu do catálogo." };

  const product: ProductRef = { store: row.store, externalId: row.externalId, productUrl: row.productUrl };
  const [link, settings] = await Promise.all([affiliateLinkFor(user.tenantId, product), getMessageSettings(user.tenantId)]);
  return {
    ok: true,
    preview: {
      product,
      catalogProductId: row.id,
      info: {
        title: row.title,
        imageUrl: row.imageUrl,
        priceCents: row.priceCents,
        originalPriceCents: row.originalPriceCents,
        discountPct: row.discountPct,
      },
      needsManualInfo: false,
      link: link.ok ? link.link : null,
      linkError: link.ok ? null : link.error,
      missingCredential: link.ok ? null : (link.missingCredential ?? null),
      settings,
    },
  };
}

const sendSchema = z.object({
  productUrl: z.string().url().max(2048),
  catalogProductId: z.string().min(1).max(100).nullable(),
  headline: z.string().trim().max(120),
  title: z.string().trim().min(2, "Informe o título do produto.").max(300),
  priceCents: z.number().int().positive("Informe o preço.").max(100_000_000),
  originalPriceCents: z.number().int().positive().max(100_000_000).nullable(),
  imageUrl: z.string().url().max(2048).nullable(),
});

export type SendResult = { ok: true; message: string; text: string } | { ok: false; error: string };

/**
 * "Enviar para meus grupos": refaz o link no servidor (não confia no que veio
 * do navegador), monta a mensagem e grava a oferta pronta. O envio aos grupos
 * é da fila da fase 5.
 */
export async function sendToGroupsAction(input: z.input<typeof sendSchema>): Promise<SendResult> {
  const { user } = await requireSession();
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const data = parsed.data;

  const url = parseHttpsUrl(data.productUrl);
  const product = url ? parseProductUrl(url) : null;
  if (!product) return { ok: false, error: "Produto inválido." };
  if (data.catalogProductId) {
    const row = await forTenant(user.tenantId).catalogProduct.findUnique({ where: { id: data.catalogProductId } });
    if (!row || row.productUrl !== product.productUrl) return { ok: false, error: "Produto do catálogo não encontrado." };
  }

  const link = await affiliateLinkFor(user.tenantId, product);
  if (!link.ok) return { ok: false, error: link.error };

  const settings = await getMessageSettings(user.tenantId);
  const originalPriceCents = data.originalPriceCents && data.originalPriceCents > data.priceCents ? data.originalPriceCents : null;
  const text = composeMessage(
    settings,
    { title: data.title, priceCents: data.priceCents, originalPriceCents, discountPct: null },
    link.link,
    data.headline || settings.headline,
  );
  await saveOfferForSending(user.tenantId, {
    catalogProductId: data.catalogProductId,
    store: product.store,
    externalId: product.externalId,
    title: data.title,
    url: product.productUrl,
    affiliateUrl: link.link,
    imageUrl: data.imageUrl,
    priceCents: data.priceCents,
    originalPriceCents,
    messageText: text,
  });
  revalidatePath("/painel/ofertas");
  return {
    ok: true,
    text,
    message: "Oferta salva com link e mensagem prontos. O envio aos grupos será feito pelo agendamento (próxima fase).",
  };
}
