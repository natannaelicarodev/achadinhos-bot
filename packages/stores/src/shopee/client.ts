// Cliente baixo nível da Open API de afiliados da Shopee (GraphQL).
// NÃO é exportado pelo pacote: use ShopeeCatalogReader (credencial central,
// só leitura) ou ShopeeLinkGenerator (credencial do cliente, gera link).
import { createHash } from "node:crypto";

export const SHOPEE_GRAPHQL_URL = "https://open-api.affiliate.shopee.com.br/graphql";

/** Assinatura exigida pela Shopee: SHA256(AppId + Timestamp + Payload + Secret), em hex. */
export function shopeeSignature(appId: string, timestamp: number, payload: string, secret: string): string {
  return createHash("sha256").update(`${appId}${timestamp}${payload}${secret}`).digest("hex");
}

export function shopeeAuthorization(appId: string, timestamp: number, signature: string): string {
  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`;
}

export class ShopeeApiError extends Error {
  override name = "ShopeeApiError";
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

export interface ShopeeCredentials {
  appId: string;
  secret: string;
}

export interface ShopeeClientOptions extends ShopeeCredentials {
  fetch?: typeof fetch;
  /** Segundos Unix (substituível nos testes). */
  now?: () => number;
  timeoutMs?: number;
}

export class ShopeeGraphqlClient {
  constructor(private readonly options: ShopeeClientOptions) {}

  async request(query: string): Promise<unknown> {
    const { appId, secret } = this.options;
    const payload = JSON.stringify({ query });
    const timestamp = this.options.now?.() ?? Math.floor(Date.now() / 1000);
    const signature = shopeeSignature(appId, timestamp, payload, secret);
    const response = await (this.options.fetch ?? fetch)(SHOPEE_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: shopeeAuthorization(appId, timestamp, signature),
      },
      body: payload,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
    });
    if (!response.ok) throw new ShopeeApiError(`Shopee respondeu HTTP ${response.status}.`);
    const body = (await response.json()) as {
      data?: unknown;
      errors?: { message?: string; extensions?: { code?: number } }[];
    };
    const error = body.errors?.[0];
    if (error) throw new ShopeeApiError(error.message ?? "Erro da API da Shopee.", error.extensions?.code);
    return body.data;
  }
}
