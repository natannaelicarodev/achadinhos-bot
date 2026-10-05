// Contrato entre o painel (página) e a extensão Achadinhos.
// Painel -> extensão: window.postMessage com source "achadinhos-panel".
// Extensão -> painel: window.postMessage com source "achadinhos-extension".
// Este arquivo roda no navegador (painel e extensão): só zod, nada de Node.
import { z } from "zod";
import { EXTENSION_SOURCE, EXTENSION_VERSION, PANEL_SOURCE, REQUEST_TYPES } from "./constants";

export { EXTENSION_SOURCE, EXTENSION_VERSION, PANEL_SOURCE, REQUEST_TYPES };

const mlProductUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && (url.hostname === "mercadolivre.com.br" || url.hostname.endsWith(".mercadolivre.com.br"));
    } catch {
      return false;
    }
  }, "Endereço de produto do Mercado Livre inválido.");

const mlTag = z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/, "Etiqueta inválida.");

const amazonProductUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "www.amazon.com.br" && /\/dp\/[A-Z0-9]{10}/i.test(url.pathname);
    } catch {
      return false;
    }
  }, "Endereço de produto da Amazon inválido.");

const amazonTag = z.string().regex(/^[a-z0-9][a-z0-9-]{0,60}-\d{2}$/, "Etiqueta da Amazon inválida.");

export const requestSchemas = {
  /** Extensão instalada? Devolve a versão. */
  ping: z.object({}),
  /** meli.la do cliente para o produto (mesmo pedido do portal de afiliados). */
  "ml.createLink": z.object({ productUrl: mlProductUrl, tag: mlTag }),
  /** Título, preço, preço original e imagem lidos da página (com a sessão do navegador). */
  "ml.productInfo": z.object({ productUrl: mlProductUrl }),
  /** Diagnóstico da instalação: onde está o token de proteção e se o ML aceita o pedido. */
  "ml.diagnose": z.object({ productUrl: mlProductUrl, tag: mlTag }),
  /** Amazon: link curto (link.amazon) com a etiqueta do cliente, pela SiteStripe. */
  "amz.createLink": z.object({ productUrl: amazonProductUrl, tag: amazonTag }),
  /** Amazon: título, preço, preço "De" e imagem da página do produto. */
  "amz.productInfo": z.object({ productUrl: amazonProductUrl }),
  /** Amazon: teste da instalação (SiteStripe e leitura do preço). */
  "amz.diagnose": z.object({ productUrl: amazonProductUrl, tag: amazonTag }),
  /** Vitrine do portal de afiliados (produtos do ML para o catálogo). */
  "ml.hubSearch": z.object({
    search: z.string().trim().max(100).default(""),
    category: z.string().regex(/^MLB\d{1,10}$/, "Categoria inválida.").nullable().default(null),
    bestSeller: z.boolean().default(true),
    offset: z.number().int().min(0).max(2000).default(0),
  }),
  /**
   * Vitrine compartilhada (só a extensão do ADMINISTRADOR): de hora em hora busca a
   * vitrine do portal e envia os produtos ao catálogo central do painel que a ativou.
   */
  "vitrine.configure": z.object({
    enabled: z.boolean(),
    token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, "Chave da vitrine inválida.").nullable().default(null),
    categories: z.array(z.string().regex(/^MLB\d{1,10}$/, "Categoria inválida.")).max(20).default([]),
    /** Palavras-chave (categorias que o portal não tem, ex.: Alimentos). */
    searches: z.array(z.string().trim().min(2).max(50)).max(30).default([]),
    /** Amazon: categorias dos "Mais vendidos" (ex.: "grocery"). */
    amazonCategories: z.array(z.string().regex(/^[a-z][a-z-]{1,40}$/, "Categoria da Amazon inválida.")).max(20).default([]),
  }),
  "vitrine.status": z.object({}),
  /**
   * Piloto automático do CLIENTE: com a chave dele, a extensão gera de minuto em minuto o
   * meli.la dos produtos do Mercado Livre que o piloto escolheu (enquanto o Chrome estiver aberto).
   */
  "autopilot.configure": z.object({
    enabled: z.boolean(),
    token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, "Chave inválida.").nullable().default(null),
  }),
  "autopilot.status": z.object({}),
  "vitrine.runNow": z.object({}),
} as const;

/** Produto da vitrine do Mercado Livre (já no formato dos cards do catálogo). */
export interface HubItem {
  id: string;
  productUrl: string;
  title: string;
  imageUrl: string | null;
  priceCents: number;
  originalPriceCents: number | null;
  discountLabel: string | null;
  commissionPct: number | null;
  extraCommission: boolean;
  rating: number | null;
  soldText: string | null;
  soldCount: number | null;
  highlight: string | null;
}

export type RequestType = keyof typeof requestSchemas;
export type RequestPayload<T extends RequestType> = z.infer<(typeof requestSchemas)[T]>;

export interface ResponseMap {
  ping: { version: string };
  "ml.createLink": { shortUrl: string; longUrl: string | null };
  "ml.productInfo": {
    title: string | null;
    imageUrl: string | null;
    priceCents: number | null;
    originalPriceCents: number | null;
  };
  "ml.diagnose": { steps: { step: string; ok: boolean; detail: string }[] };
  "amz.createLink": { shortUrl: string };
  "amz.productInfo": { title: string | null; imageUrl: string | null; priceCents: number | null; originalPriceCents: number | null };
  "amz.diagnose": { steps: { step: string; ok: boolean; detail: string }[] };
  "ml.hubSearch": { items: HubItem[]; hasMore: boolean };
  "autopilot.configure": AutopilotLinkStatus;
  "autopilot.status": AutopilotLinkStatus;
  "vitrine.configure": VitrineStatus;
  "vitrine.status": VitrineStatus;
  "vitrine.runNow": VitrineStatus;
}

/** Piloto automático do cliente nesta extensão (nunca devolve a chave). */
export interface AutopilotLinkStatus {
  enabled: boolean;
  lastRunAt: string | null;
  lastResult: { ok: boolean; message: string } | null;
  /** Relatório do Mercado Livre (de hora em hora). */
  reportsLastRunAt: string | null;
  reportsLastResult: { ok: boolean; message: string } | null;
}

/** Estado da vitrine compartilhada nesta extensão (nunca devolve a chave). */
export interface VitrineStatus {
  enabled: boolean;
  /** Painel que recebe os produtos (origem que ativou). */
  endpoint: string | null;
  running: boolean;
  lastRunAt: string | null;
  lastResult: { ok: boolean; message: string } | null;
  /** Captcha/bloqueio em alguma loja: vitrine parada até este horário (ISO). */
  blockedUntil: string | null;
}

export type ExtensionResult<T extends RequestType> = { ok: true; data: ResponseMap[T] } | { ok: false; error: string };

export const panelMessageSchema = z.object({
  source: z.literal(PANEL_SOURCE),
  id: z.string().min(1).max(64),
  type: z.enum(REQUEST_TYPES),
  payload: z.unknown(),
});
export type PanelMessage = z.infer<typeof panelMessageSchema>;

export interface ExtensionMessage<T extends RequestType = RequestType> {
  source: typeof EXTENSION_SOURCE;
  id: string;
  result: ExtensionResult<T>;
}

/** Valida tipo + payload de um pedido. Erro em pt-BR se inválido. */
export function parseRequest(type: RequestType, payload: unknown): { ok: true; payload: unknown } | { ok: false; error: string } {
  const parsed = requestSchemas[type].safeParse(payload);
  return parsed.success ? { ok: true, payload: parsed.data } : { ok: false, error: parsed.error.issues[0]?.message ?? "Pedido inválido." };
}

/** Compara versões "a.b.c". true se `installed` for mais antiga que `latest`. */
export function isOutdated(installed: string, latest: string = EXTENSION_VERSION): boolean {
  const a = installed.split(".").map(Number);
  const b = latest.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}
