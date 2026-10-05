// Vitrine do portal de afiliados ("Produtos selecionados para você"): mesma busca
// que o portal faz, com a sessão do navegador. Converte os cards do ML para o
// formato dos cards do catálogo.
import { z } from "zod";
import { MlError, ML_ORIGIN } from "./ml";
import type { HubItem } from "./protocol";

export type { HubItem };

/** Pedido interno da vitrine (visto no portal). Pode mudar sem aviso. */
export const HUB_SEARCH_URL = `${ML_ORIGIN}/affiliate-program/api/hub/search?is_affiliate=true&device=desktop`;

export interface HubSearchParams {
  search: string;
  /** Código de categoria do ML (ex.: MLB1246) ou null. */
  category: string | null;
  bestSeller: boolean;
  offset: number;
}

export function hubSearchBody(params: HubSearchParams) {
  const filters: { id: string; value: string | boolean }[] = [];
  if (params.category) filters.push({ id: "category", value: params.category });
  if (params.bestSeller) filters.push({ id: "best_seller", value: true });
  return { search: params.search, sort: "relevance", filters, offset: params.offset };
}

const component = z.object({ type: z.string(), id: z.string().optional() }).passthrough();
const polycard = z
  .object({
    metadata: z.object({ id: z.string(), url: z.string() }).passthrough(),
    pictures: z.object({ pictures: z.array(z.object({ id: z.string() })).optional() }).passthrough().optional(),
    components: z.array(component).default([]),
  })
  .passthrough();
const searchResponse = z
  .object({ polycard_client_model: z.object({ polycards: z.array(z.unknown()).default([]) }).passthrough() })
  .passthrough();

type Component = z.infer<typeof component> & Record<string, unknown>;
const get = (obj: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), obj);
const toCents = (value: unknown) => (typeof value === "number" && value > 0 ? Math.round(value * 100) : null);

/** "+10mil" -> 10000, "+1000" -> 1000, "+100" -> 100. */
export function parseSoldCount(text: string): number | null {
  const m = text.match(/\+?\s*([\d.,]+)\s*(mil|mi)?/i);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const unit = m[2]?.toLowerCase();
  return Math.round(unit === "mil" ? n * 1000 : unit === "mi" ? n * 1_000_000 : n);
}

/**
 * Monta o texto de um selo do card: "{ganancia} {extra}" + values -> "GANHOS 10% + EXTRA".
 * Aceita valores com label.text, text ou value (o portal varia o formato entre cards).
 */
function renderPill(pill: unknown): string {
  const template = String(get(pill, "text") ?? "");
  const values = get(pill, "values");
  const byKey = new Map<string, string>();
  const loose: string[] = [];
  if (Array.isArray(values)) {
    for (const v of values) {
      const candidates = [get(v, "label", "text"), get(v, "text"), get(v, "text", "text"), get(v, "value"), get(v, "label", "value")];
      const raw = candidates.find((c) => typeof c === "string" || typeof c === "number");
      const text = raw === undefined ? "" : String(raw);
      const key = get(v, "key");
      if (typeof key === "string") byKey.set(key, text);
      else loose.push(text);
    }
  }
  const rendered = template.replace(/\{([^}]+)\}/g, (_, key: string) => byKey.get(key) ?? "");
  return [rendered, ...loose].join(" ").replace(/\s+/g, " ").trim();
}

/** Textos de todos os selos de comissão do card ("GANHOS 5%", "GANHOS EXTRAS 8%", "GANHOS 10% + EXTRA"). */
function commissionOf(components: Component[]): { pct: number | null; extra: boolean } {
  const texts: string[] = [];
  for (const c of components) {
    const id = `${c.id ?? ""} ${c.type}`;
    const pill = get(c, "chip", "pill") ?? get(c, c.type);
    const text = renderPill(pill);
    const isCommission = /commission|comision|comissao/i.test(id) || /GANHOS|GANANCIA/i.test(text);
    if (!isCommission) continue;
    texts.push(text);
    // Formato desconhecido: procura "N%" em qualquer texto do selo.
    if (!/%/.test(text)) texts.push(JSON.stringify(c));
  }
  const joined = texts.join(" ");
  const pct = joined.match(/(\d+(?:[.,]\d+)?)\s*%/)?.[1];
  return { pct: pct ? Number(pct.replace(",", ".")) : null, extra: /extra/i.test(joined) };
}

/** Converte um card da vitrine. null se faltar título, endereço ou preço. */
export function toHubItem(raw: unknown): HubItem | null {
  const parsed = polycard.safeParse(raw);
  if (!parsed.success) return null;
  const card = parsed.data;
  const byId = (id: string) => card.components.find((c) => c.id === id || c.type === id) as Component | undefined;

  const title = get(byId("title"), "title", "text");
  const price = byId("price");
  const priceCents = toCents(get(price, "price", "current_price", "value"));
  if (typeof title !== "string" || !title.trim() || !priceCents) return null;

  const path = card.metadata.url.replace(/^https?:\/\//, "");
  if (!/^(www\.|produto\.)?mercadolivre\.com\.br\//.test(path)) return null;

  const originalPriceCents = toCents(get(price, "price", "previous_price", "value"));
  const review = get(byId("review_compacted"), "review_compacted", "values");
  const labels = Array.isArray(review) ? review.map((v) => get(v, "label", "text")).filter((t): t is string => typeof t === "string") : [];
  const rating = labels.map((t) => Number(t.replace(",", "."))).find((n) => Number.isFinite(n) && n > 0 && n <= 5) ?? null;
  const soldText = labels.find((t) => /vendid/i.test(t))?.replace(/^\|\s*/, "").trim() ?? null;
  const commission = commissionOf(card.components as Component[]);
  const pictureId = card.pictures?.pictures?.[0]?.id;
  const highlight = get(byId("highlight"), "highlight", "text");
  const discount = get(price, "price", "discount_label", "text");

  return {
    id: card.metadata.id,
    productUrl: `https://${path.split(/[?#]/)[0]}`,
    title: title.trim(),
    imageUrl: pictureId && /^[\w-]+$/.test(pictureId) ? `https://http2.mlstatic.com/D_Q_NP_2X_${pictureId}-AB.webp` : null,
    priceCents,
    originalPriceCents: originalPriceCents && originalPriceCents > priceCents ? originalPriceCents : null,
    discountLabel: typeof discount === "string" ? discount : null,
    commissionPct: commission.pct,
    extraCommission: commission.extra || get(card.metadata, "extra_commission") === "true",
    rating,
    soldText,
    soldCount: soldText ? parseSoldCount(soldText) : null,
    highlight: typeof highlight === "string" ? highlight.replace(/\{[^}]+\}\s*/g, "").trim() || null : null,
  };
}

export function parseHubSearch(body: unknown): HubItem[] {
  const parsed = searchResponse.safeParse(body);
  if (!parsed.success) throw new MlError("A vitrine do Mercado Livre respondeu num formato inesperado.");
  return parsed.data.polycard_client_model.polycards.map(toHubItem).filter((i): i is HubItem => i !== null);
}

export async function searchHub(http: typeof fetch, params: HubSearchParams, csrfToken: string): Promise<HubItem[]> {
  const response = await http(HUB_SEARCH_URL, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(hubSearchBody(params)),
  });
  if (response.status === 401 || response.status === 403) {
    throw new MlError(
      "O Mercado Livre recusou o pedido. Entre na sua conta do Mercado Livre neste navegador e tente de novo.",
      response.status,
    );
  }
  if (!response.ok) throw new MlError(`A vitrine do Mercado Livre respondeu HTTP ${response.status}.`, response.status);
  return parseHubSearch(await response.json());
}
