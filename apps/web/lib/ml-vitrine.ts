import { isVerifiedAdmin } from "@achadinhos/db";
// Vitrine compartilhada do Mercado Livre: produtos que a extensão do ADMINISTRADOR
// envia (vitrine do portal de afiliados) viram produtos do catálogo central.
import { createHash, timingSafeEqual } from "node:crypto";
import { normalizeSearchText, type CatalogCategory, type MinedProduct } from "@achadinhos/db";
import { z } from "zod";
import { ML_CATEGORY_IDS, ML_KEYWORD_SEARCHES } from "./catalog";

const CATEGORY_BY_ML_ID = new Map<string, CatalogCategory>(
  Object.entries(ML_CATEGORY_IDS).map(([category, mlId]) => [mlId, category as CatalogCategory]),
);

const mlUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "mercadolivre.com.br" || url.hostname.endsWith(".mercadolivre.com.br"));
  });

const cents = z.number().int().positive().max(100_000_000);

const hubItemSchema = z.object({
  id: z.string().regex(/^MLBU?\d{5,15}$/),
  productUrl: mlUrl,
  title: z.string().trim().min(1).max(300),
  imageUrl: z
    .string()
    .url()
    .max(2048)
    .refine((v) => new URL(v).hostname.endsWith("mlstatic.com"))
    .nullable(),
  priceCents: cents,
  originalPriceCents: cents.nullable(),
  commissionPct: z.number().min(0).max(100).nullable(),
  rating: z.number().min(0).max(5).nullable(),
  soldCount: z.number().int().min(0).max(1_000_000_000).nullable(),
});

export const vitrinePayloadSchema = z.object({
  batches: z
    .array(
      z.object({
        mlCategory: z.string().regex(/^MLB\d{1,10}$/).nullable(),
        search: z.string().max(50).default(""),
        // Item inválido é descartado (não derruba a leva inteira).
        items: z.array(z.unknown()).max(500),
      }),
    )
    .max(20),
});

// A busca por palavra do portal é "frouxa": devolve produtos populares e utensílios
// (coador de café, taça de vinho...). Nos títulos do ML a PRIMEIRA palavra diz o que
// o produto é, então Alimentos só aceita título que COMEÇA com comida/bebida
// (depois de "kit", "caixa", "combo"... e números/quantidades).
const FOOD_WORDS = new Set([
  "chocolate", "cafe", "biscoito", "bolacha", "bala", "pirulito", "doce", "bombom", "azeite", "vinho", "cerveja",
  "tempero", "cha", "suco", "refrigerante", "whisky", "vodka", "gin", "cachaca", "leite", "granola", "castanha",
  "amendoim", "geleia", "molho", "macarrao", "arroz", "feijao", "acucar", "pimenta", "achocolatado", "whey",
  "proteina", "chiclete", "goma", "pacoca", "barra", "cookie", "snack", "salgadinho", "energetico",
]);
const LEADING_FILLERS = new Set(["kit", "caixa", "combo", "pack", "pacote", "display", "com", "de", "do", "da", "e", "x", "un", "und", "unidades"]);

/** Título é de comida/bebida? Olha a primeira palavra "de verdade" (minúsculas e sem acento). */
export function isFoodTitle(title: string): boolean {
  const text = normalizeSearchText(title);
  // Livro com nome de comida ("Café com Deus Pai Vol. 6 - Editora ...").
  if (/(^|[^a-z0-9])(livro|editora|vol|ebook|capa mole|capa dura)([^a-z0-9]|$)/.test(text)) return false;
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  const first = words.find((w) => !LEADING_FILLERS.has(w) && !/^\d/.test(w));
  if (!first) return false;
  // Plural: "chocolates" -> "chocolate", "pirulitos" -> "pirulito", "acucares" -> "acucar".
  return [first, first.replace(/s$/, ""), first.replace(/es$/, "")].some((w) => FOOD_WORDS.has(w));
}

/** Converte as levas da vitrine em produtos minerados (descarta itens inválidos). */
export function vitrineToMinedProducts(payload: z.infer<typeof vitrinePayloadSchema>): MinedProduct[] {
  const products: MinedProduct[] = [];
  for (const batch of payload.batches) {
    // Categoria decidida AQUI (pelo código do ML ou pela palavra da lista do painel), nunca pela extensão.
    const category =
      (batch.mlCategory && CATEGORY_BY_ML_ID.get(batch.mlCategory)) ||
      (batch.search && ML_KEYWORD_SEARCHES[batch.search.trim().toLowerCase()]) ||
      "OTHER";
    for (const raw of batch.items) {
      const parsed = hubItemSchema.safeParse(raw);
      if (!parsed.success) continue;
      const item = parsed.data;
      // Busca por palavra (Alimentos): resultado fora do tema é descartado.
      if (batch.search && category === "FOOD_BEVERAGES" && !isFoodTitle(item.title)) continue;
      const original = item.originalPriceCents && item.originalPriceCents > item.priceCents ? item.originalPriceCents : null;
      products.push({
        store: "MERCADO_LIVRE",
        externalId: item.id,
        title: item.title,
        imageUrl: item.imageUrl,
        productUrl: item.productUrl,
        category,
        priceCents: item.priceCents,
        originalPriceCents: original,
        discountPct: original ? Math.round((1 - item.priceCents / original) * 100) : null,
        commissionPct: item.commissionPct,
        commissionCents: item.commissionPct === null ? null : Math.round((item.priceCents * item.commissionPct) / 100),
        rating: item.rating,
        soldCount: item.soldCount,
      });
    }
  }
  return products;
}

const sha = (value: string) => createHash("sha256").update(value).digest();

/** Confere a chave da vitrine (ML_VITRINE_TOKEN) em tempo constante. Sem chave no .env = desligado. */
export function isValidVitrineToken(authorization: string | null, expected: string | undefined): boolean {
  const configured = expected?.trim();
  if (!configured || configured.length < 32) return false;
  const given = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!given) return false;
  return timingSafeEqual(sha(given), sha(configured));
}

/**
 * Administrador do sistema: e-mail em SYSTEM_ADMIN_EMAILS E confirmado pelo link (sem confirmar,
 * qualquer um poderia se cadastrar com o e-mail da lista).
 */
export function isSystemAdmin(
  user: { email: string; emailVerifiedAt: Date | null },
  list: string | undefined = process.env.SYSTEM_ADMIN_EMAILS,
): boolean {
  return isVerifiedAdmin(user, list);
}
