// Vitrine compartilhada da Amazon: "Mais vendidos" lidos pela extensão do ADMINISTRADOR
// viram produtos do catálogo central. A categoria é decidida AQUI (pela página de
// mais vendidos), nunca pela extensão.
import type { MinedProduct } from "@achadinhos/db";
import { z } from "zod";
import { AMAZON_BESTSELLER_CATEGORIES } from "./catalog";

/**
 * A Amazon não mostra vendidos: para o ranking usamos as avaliações como estimativa
 * de popularidade (só ordena; o card não mostra "vendidos" para a Amazon).
 */
export const AMAZON_POPULARITY_PER_RATING = 10;

const cents = z.number().int().positive().max(100_000_000);
const amazonImageHost = (value: string) => {
  const host = new URL(value).hostname;
  return host.endsWith("media-amazon.com") || host.endsWith("ssl-images-amazon.com");
};

const bestsellerSchema = z
  .object({
    asin: z.string().regex(/^[A-Z0-9]{10}$/),
    productUrl: z.string().url().max(200),
    title: z.string().trim().min(1).max(400),
    imageUrl: z.string().url().max(2048).refine(amazonImageHost).nullable(),
    priceCents: cents,
    rating: z.number().min(0).max(5).nullable(),
    ratingsCount: z.number().int().min(0).max(100_000_000).nullable(),
  })
  // Só o endereço limpo do próprio produto (nada de link com etiqueta de alguém).
  .refine((item) => item.productUrl === `https://www.amazon.com.br/dp/${item.asin}`);

export const amazonVitrinePayloadSchema = z.object({
  batches: z
    .array(
      z.object({
        slug: z.string().regex(/^[a-z][a-z-]{1,40}$/),
        // Item inválido é descartado (não derruba a leva inteira).
        items: z.array(z.unknown()).max(200),
      }),
    )
    .max(20),
});

/** Converte as levas dos mais vendidos em produtos minerados (descarta itens e categorias inválidos). */
export function amazonVitrineToMinedProducts(payload: z.infer<typeof amazonVitrinePayloadSchema>): MinedProduct[] {
  const products: MinedProduct[] = [];
  for (const batch of payload.batches) {
    const category = AMAZON_BESTSELLER_CATEGORIES[batch.slug];
    if (!category) continue;
    for (const raw of batch.items) {
      const parsed = bestsellerSchema.safeParse(raw);
      if (!parsed.success) continue;
      const item = parsed.data;
      products.push({
        store: "AMAZON",
        externalId: item.asin,
        title: item.title,
        imageUrl: item.imageUrl,
        productUrl: item.productUrl,
        category,
        priceCents: item.priceCents,
        originalPriceCents: null,
        discountPct: null,
        commissionPct: null,
        commissionCents: null,
        rating: item.rating,
        soldCount: null,
        popularity: item.ratingsCount === null ? null : item.ratingsCount * AMAZON_POPULARITY_PER_RATING,
      });
    }
  }
  return products;
}
