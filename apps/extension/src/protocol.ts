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

export const requestSchemas = {
  /** Extensão instalada? Devolve a versão. */
  ping: z.object({}),
  /** meli.la do cliente para o produto (mesmo pedido do portal de afiliados). */
  "ml.createLink": z.object({ productUrl: mlProductUrl, tag: mlTag }),
  /** Título, preço, preço original e imagem lidos da página (com a sessão do navegador). */
  "ml.productInfo": z.object({ productUrl: mlProductUrl }),
  /** Diagnóstico da instalação: onde está o token de proteção e se o ML aceita o pedido. */
  "ml.diagnose": z.object({ productUrl: mlProductUrl, tag: mlTag }),
} as const;

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
