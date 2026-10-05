// Headlines (chamadas) da mensagem. Sem IA e sem custo: implementação "dicionário".
// A IA (fase 7, adiada) entra depois como outra implementação de CaptionProvider,
// sem mexer em quem usa.
import type { CatalogCategory } from "@achadinhos/db";
import {
  CATEGORY_HEADLINES,
  DISCOUNT_HEADLINE_EVERY,
  DISCOUNT_HEADLINE_MIN_PCT,
  DISCOUNT_HEADLINES,
  FEMININE_WORDS,
  GENERIC_HEADLINES,
  KEYWORD_NOT_AFTER,
  MASCULINE_WORDS,
  PRODUCT_TYPES,
  type HeadlineType,
} from "./dictionary";

/** Chave guardada no CatalogProduct.headlineKey: "type:{tipo}", "category:{CATEGORIA}" ou "generic". */
export type HeadlineKey = string;
export const GENERIC_HEADLINE_KEY = "generic";
/** Quantas mensagens recentes do grupo não podem repetir a headline. */
export const HEADLINE_NO_REPEAT = 10;

export interface CaptionProduct {
  title: string;
  category?: CatalogCategory | null;
  discountPct?: number | null;
}

export interface PickOptions {
  /** Últimas headlines do grupo, da mais nova para a mais antiga. */
  recent?: string[];
  /** Mesma mensagem indo para vários grupos: as últimas de CADA grupo (vale a regra em todos). */
  recentByGroup?: string[][];
  /** Já vistas pela pessoa ("Quero outra headline"). */
  exclude?: string[];
  /** Headlines próprias do cliente: entram no sorteio junto com as do tipo. */
  extra?: string[];
  random?: () => number;
}

export interface CaptionProvider {
  /** Classifica o produto (pré-calculado ao minerar e guardado no catálogo). */
  classify(product: CaptionProduct): HeadlineKey;
  /**
   * Categoria do tipo (ex.: "type:controle-pragas" -> Casa). O tipo vale mais que a categoria
   * da loja: armadilha para barata que veio como Pets passa para Casa. null = não corrige.
   */
  categoryOf(key: HeadlineKey): CatalogCategory | null;
  /** Headlines possíveis para a chave (gênero do título e desconto alto entram junto). */
  candidates(key: HeadlineKey, product: CaptionProduct, options?: { allowDiscount?: boolean }): string[];
  /**
   * Escolhe uma headline: não repete as 10 últimas do grupo, desconto no máximo 1 a cada 3,
   * e evita as já vistas. Acabou o tipo -> categoria -> genéricas.
   */
  pick(key: HeadlineKey, product: CaptionProduct, options?: PickOptions): string;
}

/** Minúsculas, sem acento e só letras/números separados por espaço. */
export function normalizeTitle(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);

interface CompiledKeyword {
  type: HeadlineType;
  keyword: string;
  re: RegExp;
}

function compile(types: HeadlineType[]): CompiledKeyword[] {
  const list: CompiledKeyword[] = [];
  for (const type of types) {
    for (const raw of type.keywords) {
      const keyword = normalizeTitle(raw);
      if (!keyword) continue;
      // Palavra inteira; aceita plural simples no fim ("panela" acha "panelas").
      list.push({ type, keyword, re: new RegExp(`(?:^| )${escapeRegExp(keyword)}(?:s|es)?(?= |$)`, "g") });
    }
  }
  return list;
}

/** Posição da primeira ocorrência que vale (pula as de KEYWORD_NOT_AFTER, ex.: "mais barata"). */
function firstValidMatch(text: string, keyword: string, re: RegExp): number | null {
  const notAfter = KEYWORD_NOT_AFTER[keyword];
  for (const match of text.matchAll(re)) {
    const index = match.index + (match[0].startsWith(" ") ? 1 : 0);
    if (!notAfter) return index;
    const previous = text.slice(0, index).trimEnd().split(" ").pop() ?? "";
    if (!notAfter.includes(previous)) return index;
  }
  return null;
}

/** Busca o tipo no título: vence a palavra-chave que aparece MAIS CEDO; empate -> a mais longa. */
export function findProductType(title: string, types: HeadlineType[] = PRODUCT_TYPES, compiled = compile(types)): HeadlineType | null {
  const text = normalizeTitle(title);
  let best: { type: HeadlineType; index: number; length: number } | null = null;
  for (const { type, keyword, re } of compiled) {
    const index = firstValidMatch(text, keyword, re);
    if (index === null) continue;
    if (!best || index < best.index || (index === best.index && keyword.length > best.length)) {
      best = { type, index, length: keyword.length };
    }
  }
  return best?.type ?? null;
}

/** "feminino/mulher" -> F; "masculino/homem" -> M; os dois ou nenhum -> neutro. */
export function titleGender(title: string): "F" | "M" | null {
  const words = new Set(normalizeTitle(title).split(" "));
  const f = FEMININE_WORDS.some((w) => words.has(w));
  const m = MASCULINE_WORDS.some((w) => words.has(w));
  return f === m ? null : f ? "F" : "M";
}

const DISCOUNT_PATTERNS = DISCOUNT_HEADLINES.map(
  (h) => new RegExp(`^${escapeRegExp(h).replace(escapeRegExp("{desconto}"), "\\d+")}$`, "i"),
);
/** A headline é uma das de desconto? */
export const isDiscountHeadline = (headline: string) => DISCOUNT_PATTERNS.some((re) => re.test(headline.trim()));

const TYPE_BY_KEY = new Map(PRODUCT_TYPES.map((t) => [t.key, t]));

function baseHeadlines(key: HeadlineKey): string[] {
  if (key.startsWith("type:")) return TYPE_BY_KEY.get(key.slice(5))?.headlines ?? GENERIC_HEADLINES;
  if (key.startsWith("category:")) {
    const category = key.slice(9) as keyof typeof CATEGORY_HEADLINES;
    return CATEGORY_HEADLINES[category] ?? GENERIC_HEADLINES;
  }
  return GENERIC_HEADLINES;
}

/** Categoria de fallback de uma chave (tipo -> categoria do tipo; senão a do produto). */
function fallbackCategory(key: HeadlineKey, product: CaptionProduct): keyof typeof CATEGORY_HEADLINES | null {
  if (key.startsWith("type:")) {
    const c = TYPE_BY_KEY.get(key.slice(5))?.category;
    if (c && c !== "OTHER") return c;
  }
  const c = product.category;
  return c && c !== "OTHER" ? c : null;
}

export class DictionaryCaptionProvider implements CaptionProvider {
  private readonly compiled = compile(PRODUCT_TYPES);

  classify(product: CaptionProduct): HeadlineKey {
    const type = findProductType(product.title, PRODUCT_TYPES, this.compiled);
    if (type) return `type:${type.key}`;
    if (product.category && product.category !== "OTHER") return `category:${product.category}`;
    return GENERIC_HEADLINE_KEY;
  }

  categoryOf(key: HeadlineKey): CatalogCategory | null {
    if (!key.startsWith("type:")) return null;
    const category = TYPE_BY_KEY.get(key.slice(5))?.category;
    return category && category !== "OTHER" ? category : null;
  }

  candidates(key: HeadlineKey, product: CaptionProduct, options: { allowDiscount?: boolean } = {}): string[] {
    const list = [...baseHeadlines(key)];
    // Gênero só quando o título diz (feminino/mulher ou masculino/homem).
    const type = key.startsWith("type:") ? TYPE_BY_KEY.get(key.slice(5)) : undefined;
    const gender = titleGender(product.title);
    if (gender === "F" && type?.feminine) list.push(...type.feminine);
    if (gender === "M" && type?.masculine) list.push(...type.masculine);
    const discount = product.discountPct ?? 0;
    if (options.allowDiscount !== false && discount >= DISCOUNT_HEADLINE_MIN_PCT) {
      list.push(...DISCOUNT_HEADLINES.map((h) => h.replace("{desconto}", String(discount))));
    }
    return list;
  }

  pick(key: HeadlineKey, product: CaptionProduct, options: PickOptions = {}): string {
    const groups = [options.recent ?? [], ...(options.recentByGroup ?? [])];
    const avoid = new Set(
      [...groups.flatMap((g) => g.slice(0, HEADLINE_NO_REPEAT)), ...(options.exclude ?? [])].map((h) => h.trim().toUpperCase()),
    );
    const random = options.random ?? Math.random;
    // Desconto: no máximo 1 a cada 3 posts do grupo (as 2 últimas de cada grupo não podem ser de desconto).
    const allowDiscount = !groups.some((g) => g.slice(0, DISCOUNT_HEADLINE_EVERY - 1).some(isDiscountHeadline));
    const category = fallbackCategory(key, product);
    // Ordem: tipo (+ gênero + desconto) -> categoria -> genéricas. A primeira lista com opção nova vence.
    const pools = [
      [...this.candidates(key, product, { allowDiscount }), ...(options.extra ?? [])],
      category && key !== `category:${category}` ? CATEGORY_HEADLINES[category] : [],
      key === GENERIC_HEADLINE_KEY ? [] : GENERIC_HEADLINES,
    ];
    for (const pool of pools) {
      const fresh = pool.filter((h) => !avoid.has(h.toUpperCase()));
      if (fresh.length > 0) return fresh[Math.floor(random() * fresh.length)] ?? fresh[0]!;
    }
    // Tudo já usado: repete do próprio tipo.
    const all = this.candidates(key, product, { allowDiscount });
    return all[Math.floor(random() * all.length)] ?? GENERIC_HEADLINES[0]!;
  }
}

export const captionProvider: CaptionProvider = new DictionaryCaptionProvider();
