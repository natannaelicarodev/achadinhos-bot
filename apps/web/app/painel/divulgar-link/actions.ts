"use server";

import { forTenant, getStoreCredentialSecrets, saveOfferForSending } from "@achadinhos/db";
import {
  amazonSecretsSchema,
  canonicalAmazonShortLink,
  isAmazonShortLink,
  isOwnAmazonLink,
  isMercadoLivreShortLink,
  isMercadoLivreSocialPage,
  isOwnMercadoLivreLink,
  mercadoLivreSecretsSchema,
  parseHttpsUrl,
  parseProductUrl,
  readMercadoLivreSocialPage,
  resolveAmazonShortLink,
  resolveMercadoLivreShortLink,
  resolveStoreUrl,
  StoreUrlError,
  type AffiliateStore,
  type AmazonSecrets,
  type MercadoLivreSecrets,
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
  type LinkResult,
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
  /** meli.la do próprio cliente, usado como está (mantém a página "recomenda" do ML). */
  shortLink: string | null;
  /** Aviso em pt-BR mostrado acima do link. */
  notice: string | null;
  /**
   * Mercado Livre: etiqueta do cliente para a EXTENSÃO gerar o meli.la no navegador
   * (null se não for ML, se já for o meli.la do cliente ou se faltar a credencial).
   */
  mlTag: string | null;
  /** Amazon: etiqueta do cliente para a EXTENSÃO gerar o link curto (link.amazon) pela SiteStripe. */
  amazonTag: string | null;
  settings: MessageSettings;
}

export type PreviewResult = { ok: true; preview: SharePreview } | { ok: false; error: string };

const ML_PREFER_SHORT_LINK =
  "Instale a extensão (menu Extensão) para gerar o seu link meli.la automaticamente, ou cole aqui o link meli.la gerado no portal de afiliados do Mercado Livre.";
const ML_OWN_SHORT_LINK = "Usando o seu link meli.la: quem clicar vê a página do Mercado Livre com a sua recomendação.";

const AMAZON_PREFER_SHORT_LINK =
  "Instale a extensão (menu Extensão) e entre na sua conta de Associados da Amazon neste Chrome para gerar o link curto automaticamente.";

async function tenantAmazonTag(tenantId: string): Promise<AmazonSecrets | null> {
  const parsed = amazonSecretsSchema.safeParse(await getStoreCredentialSecrets(tenantId, "AMAZON"));
  return parsed.success ? parsed.data : null;
}

/** Link curto da Amazon gerado pela extensão: confere etiqueta (e produto) do cliente. */
async function verifyAmazonShortLink(tenantId: string, url: URL, expectedAsin?: string): Promise<string | null> {
  const resolved = await resolveAmazonShortLink(url.toString());
  return isOwnAmazonLink(resolved, await tenantAmazonTag(tenantId), expectedAsin) ? canonicalAmazonShortLink(url) : null;
}

async function tenantMercadoLivreTags(tenantId: string): Promise<MercadoLivreSecrets | null> {
  const parsed = mercadoLivreSecretsSchema.safeParse(await getStoreCredentialSecrets(tenantId, "MERCADO_LIVRE"));
  return parsed.success ? parsed.data : null;
}

/** meli.la sem parâmetros (o que vai na mensagem). */
const canonicalShortLink = (url: URL) => `https://${url.hostname}${url.pathname}`;

/** Produto do meli.la quando a página social não mostra o anúncio: identificado pelo próprio link curto. */
function shortLinkProductRef(shortLink: URL, landing: URL): ProductRef {
  return {
    store: "MERCADO_LIVRE",
    externalId: `meli.la${shortLink.pathname}`.slice(0, 100),
    productUrl: `${landing.origin}${landing.pathname}`,
  };
}

function buildPreview(
  base: Pick<SharePreview, "product" | "catalogProductId" | "settings"> &
    Partial<Pick<SharePreview, "shortLink" | "notice" | "mlTag" | "amazonTag">>,
  info: (PageProductInfo & { discountPct?: number | null }) | null,
  link: LinkResult,
  needsManualInfo: boolean,
): SharePreview {
  return {
    ...base,
    shortLink: base.shortLink ?? null,
    notice: base.notice ?? null,
    mlTag: base.mlTag ?? null,
    amazonTag: base.amazonTag ?? null,
    info: {
      title: info?.title ?? null,
      imageUrl: info?.imageUrl ?? null,
      priceCents: info?.priceCents ?? null,
      originalPriceCents: info?.originalPriceCents ?? null,
      discountPct: info?.discountPct ?? null,
    },
    needsManualInfo,
    link: link.ok ? link.link : null,
    linkError: link.ok ? null : link.error,
    missingCredential: link.ok ? null : (link.missingCredential ?? null),
  };
}

/** meli.la colado: do próprio cliente -> usa como está; de outra pessoa -> converte o produto. */
async function previewMercadoLivreShortLink(tenantId: string, shortLink: URL): Promise<PreviewResult> {
  const { tags, landing } = await resolveMercadoLivreShortLink(shortLink.toString());
  const [own, settings] = await Promise.all([tenantMercadoLivreTags(tenantId), getMessageSettings(tenantId)]);

  let product = parseProductUrl(landing);
  let info: PageProductInfo | null = null;
  if (product) info = await readProductInfo(product);
  else if (isMercadoLivreSocialPage(landing)) ({ info, product } = await readMercadoLivreSocialPage(landing));
  const needsManualInfo = !info?.title || !info.priceCents;

  if (isOwnMercadoLivreLink(tags, own)) {
    const link = canonicalShortLink(shortLink);
    return {
      ok: true,
      preview: buildPreview(
        {
          product: product ?? shortLinkProductRef(shortLink, landing),
          catalogProductId: null,
          settings,
          shortLink: link,
          notice: ML_OWN_SHORT_LINK,
        },
        info,
        { ok: true, link },
        needsManualInfo,
      ),
    };
  }
  if (!product) {
    return { ok: false, error: "Não encontrei o produto nesse link. Abra o produto no Mercado Livre e cole o endereço da página dele." };
  }
  const link = await affiliateLinkFor(tenantId, product);
  return {
    ok: true,
    preview: buildPreview(
      { product, catalogProductId: null, settings, notice: ML_PREFER_SHORT_LINK, mlTag: own?.mattWord ?? null },
      info,
      link,
      needsManualInfo,
    ),
  };
}

/** "Divulgar link": identifica a loja, converte com a credencial do cliente e lê os dados do produto. */
export async function previewPastedLinkAction(rawUrl: string): Promise<PreviewResult> {
  const { user } = await requireSession();
  const input = z.string().trim().min(8).max(2048).safeParse(rawUrl);
  const first = input.success ? parseHttpsUrl(input.data) : null;
  if (!first) return { ok: false, error: "Cole um endereço válido (começando com https://)." };

  let product: ProductRef | null = null;
  try {
    if (isMercadoLivreShortLink(first)) return await previewMercadoLivreShortLink(user.tenantId, first);
    product = parseProductUrl(first);
    if (!product) {
      // Segue o link curto só até chegar numa página de produto.
      const chain = await resolveStoreUrl(first.toString(), { stopWhen: (url) => parseProductUrl(url) !== null });
      product = chain.map(parseProductUrl).findLast((p) => p !== null) ?? null;
    }
  } catch (error) {
    if (error instanceof StoreUrlError) return { ok: false, error: error.message };
    throw error;
  }
  if (!product) {
    return { ok: false, error: "Não encontrei um produto nesse endereço. Abra a página do produto na loja e copie o link de lá." };
  }

  const isMl = product.store === "MERCADO_LIVRE";
  const isAmazon = product.store === "AMAZON";
  const [link, info, settings, mlTags, amazon] = await Promise.all([
    affiliateLinkFor(user.tenantId, product),
    readProductInfo(product),
    getMessageSettings(user.tenantId),
    isMl ? tenantMercadoLivreTags(user.tenantId) : Promise.resolve(null),
    isAmazon ? tenantAmazonTag(user.tenantId) : Promise.resolve(null),
  ]);
  return {
    ok: true,
    preview: buildPreview(
      {
        product,
        catalogProductId: null,
        settings,
        notice: isMl ? ML_PREFER_SHORT_LINK : isAmazon && amazon ? AMAZON_PREFER_SHORT_LINK : null,
        mlTag: mlTags?.mattWord ?? null,
        amazonTag: amazon?.tag ?? null,
      },
      info,
      link,
      !info?.title || !info.priceCents,
    ),
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
  const isMl = row.store === "MERCADO_LIVRE";
  const isAmazon = row.store === "AMAZON";
  const [link, settings, mlTags, amazon] = await Promise.all([
    affiliateLinkFor(user.tenantId, product),
    getMessageSettings(user.tenantId),
    isMl ? tenantMercadoLivreTags(user.tenantId) : Promise.resolve(null),
    isAmazon ? tenantAmazonTag(user.tenantId) : Promise.resolve(null),
  ]);
  return {
    ok: true,
    preview: buildPreview(
      {
        product,
        catalogProductId: row.id,
        settings,
        ...(isMl ? { notice: ML_PREFER_SHORT_LINK, mlTag: mlTags?.mattWord ?? null } : {}),
        ...(isAmazon && amazon ? { notice: AMAZON_PREFER_SHORT_LINK, amazonTag: amazon.tag } : {}),
      },
      {
        title: row.title,
        imageUrl: row.imageUrl,
        priceCents: row.priceCents,
        originalPriceCents: row.originalPriceCents,
        discountPct: row.discountPct,
      },
      link,
      false,
    ),
  };
}

/**
 * meli.la gerado pela EXTENSÃO no navegador: o servidor confere que é do
 * cliente (Etiqueta e ID da Ferramenta batem) antes de o painel usar.
 */
export async function confirmExtensionLinkAction(
  shortLink: string,
  productUrl?: string,
): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  const { user } = await requireSession();
  const url = parseHttpsUrl(z.string().max(300).catch("").parse(shortLink));
  if (url && isAmazonShortLink(url)) {
    const product = productUrl ? parseHttpsUrl(productUrl) : null;
    const expected = product ? parseProductUrl(product) : null;
    try {
      const link = await verifyAmazonShortLink(user.tenantId, url, expected?.store === "AMAZON" ? expected.externalId : undefined);
      return link
        ? { ok: true, link }
        : {
            ok: false,
            error:
              "O link curto gerado não é da etiqueta configurada em Credenciais. Confira se a conta de Associados logada neste Chrome é a mesma.",
          };
    } catch (error) {
      if (error instanceof StoreUrlError) return { ok: false, error: error.message };
      throw error;
    }
  }
  if (!url || !isMercadoLivreShortLink(url)) return { ok: false, error: "A extensão devolveu um link inválido." };
  try {
    const { tags } = await resolveMercadoLivreShortLink(url.toString());
    if (!isOwnMercadoLivreLink(tags, await tenantMercadoLivreTags(user.tenantId))) {
      return {
        ok: false,
        error:
          "O link gerado não é da etiqueta configurada em Credenciais. Confira se o Mercado Livre logado neste navegador é a mesma conta de afiliado.",
      };
    }
    return { ok: true, link: canonicalShortLink(url) };
  } catch (error) {
    if (error instanceof StoreUrlError) return { ok: false, error: error.message };
    throw error;
  }
}

const sendSchema = z.object({
  productUrl: z.string().url().max(2048),
  catalogProductId: z.string().min(1).max(100).nullable(),
  shortLink: z.string().url().max(300).nullable(),
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

  let product: ProductRef | null;
  let affiliateUrl: string;
  const short = data.shortLink ? parseHttpsUrl(data.shortLink) : null;
  if (short && isAmazonShortLink(short)) {
    // Link curto da Amazon do cliente: confere de novo etiqueta e produto.
    const url = parseHttpsUrl(data.productUrl);
    product = url ? parseProductUrl(url) : null;
    if (!product || product.store !== "AMAZON") return { ok: false, error: "Produto inválido." };
    if (data.catalogProductId) {
      const row = await forTenant(user.tenantId).catalogProduct.findUnique({ where: { id: data.catalogProductId } });
      if (!row || row.productUrl !== product.productUrl) return { ok: false, error: "Produto do catálogo não encontrado." };
    }
    try {
      const link = await verifyAmazonShortLink(user.tenantId, short, product.externalId);
      if (!link) return { ok: false, error: "Este link curto da Amazon não é da sua etiqueta de Associados." };
      affiliateUrl = link;
    } catch (error) {
      if (error instanceof StoreUrlError) return { ok: false, error: error.message };
      throw error;
    }
  } else if (short) {
    // meli.la do cliente: confere de novo que é dele antes de usar como está.
    if (!isMercadoLivreShortLink(short)) return { ok: false, error: "Link inválido." };
    try {
      const { tags, landing } = await resolveMercadoLivreShortLink(short.toString());
      if (!isOwnMercadoLivreLink(tags, await tenantMercadoLivreTags(user.tenantId))) {
        return { ok: false, error: "Este link meli.la não é da sua conta de afiliado." };
      }
      const url = parseHttpsUrl(data.productUrl);
      product = (url && parseProductUrl(url)) || shortLinkProductRef(short, landing);
      affiliateUrl = canonicalShortLink(short);
    } catch (error) {
      if (error instanceof StoreUrlError) return { ok: false, error: error.message };
      throw error;
    }
  } else {
    const url = parseHttpsUrl(data.productUrl);
    product = url ? parseProductUrl(url) : null;
    if (!product) return { ok: false, error: "Produto inválido." };
    if (data.catalogProductId) {
      const row = await forTenant(user.tenantId).catalogProduct.findUnique({ where: { id: data.catalogProductId } });
      if (!row || row.productUrl !== product.productUrl) return { ok: false, error: "Produto do catálogo não encontrado." };
    }
    const link = await affiliateLinkFor(user.tenantId, product);
    if (!link.ok) return { ok: false, error: link.error };
    affiliateUrl = link.link;
  }

  const settings = await getMessageSettings(user.tenantId);
  const originalPriceCents = data.originalPriceCents && data.originalPriceCents > data.priceCents ? data.originalPriceCents : null;
  const text = composeMessage(
    settings,
    { title: data.title, priceCents: data.priceCents, originalPriceCents, discountPct: null },
    affiliateUrl,
    data.headline || settings.headline,
  );
  await saveOfferForSending(user.tenantId, {
    // meli.la colado pode ser de produto fora do catálogo; link curto da Amazon é do produto conferido.
    catalogProductId: short && !isAmazonShortLink(short) ? null : data.catalogProductId,
    store: product.store,
    externalId: product.externalId,
    title: data.title,
    url: product.productUrl,
    affiliateUrl,
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
