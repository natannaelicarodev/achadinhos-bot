// Amazon: Creators API (substituiu a PA-API 5) com a credencial CENTRAL do sistema.
// Confirmado na documentação oficial: token OAuth (client_credentials) e
// POST https://creatorsapi.amazon/catalog/v1/getItems com cabeçalho x-marketplace.
// O caminho HTTP do SearchItems NÃO aparece na documentação oficial: o
// minerador fica desligado até ser confirmado (não inventamos endpoint).
import type { MinedProduct } from "@achadinhos/db";
import { z } from "zod";
import type { CatalogMiner, MineResult, MinerStatus } from "./types";

/** Credencial v3.1 (região NA, inclui Brasil). */
export const AMAZON_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
export const AMAZON_GET_ITEMS_URL = "https://creatorsapi.amazon/catalog/v1/getItems";
export const AMAZON_MARKETPLACE = "www.amazon.com.br";

const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() });

export interface AmazonCredentials {
  credentialId: string;
  credentialSecret: string;
  partnerTag: string;
}

export class AmazonCreatorsClient {
  private token: { value: string; expiresAt: number } | undefined;

  constructor(
    private readonly credentials: AmazonCredentials,
    private readonly http: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Token OAuth com cache (renova 60s antes de expirar). */
  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const response = await this.http(AMAZON_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.credentials.credentialId,
        client_secret: this.credentials.credentialSecret,
        scope: "creatorsapi::default",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Amazon (token) respondeu HTTP ${response.status}.`);
    const body = tokenSchema.parse(await response.json());
    this.token = { value: body.access_token, expiresAt: this.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  /** GetItems (até 10 ASINs). Resposta bruta: o mapeamento entra quando o minerador for ligado. */
  async getItems(asins: string[], resources: string[]): Promise<unknown> {
    const response = await this.http(AMAZON_GET_ITEMS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "Content-Type": "application/json",
        "x-marketplace": AMAZON_MARKETPLACE,
      },
      body: JSON.stringify({
        itemIds: asins,
        itemIdType: "ASIN",
        marketplace: AMAZON_MARKETPLACE,
        partnerTag: this.credentials.partnerTag,
        resources,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Amazon (getItems) respondeu HTTP ${response.status}.`);
    return response.json();
  }
}

export const AMAZON_DISABLED_REASONS = {
  missingCredentials:
    "Credencial central da Amazon não configurada (AMAZON_CATALOG_CREDENTIAL_ID, AMAZON_CATALOG_CREDENTIAL_SECRET e AMAZON_CATALOG_PARTNER_TAG).",
  searchNotConfirmed:
    "Minerador da Amazon desligado: o endpoint do SearchItems da Creators API ainda não foi confirmado na documentação oficial.",
} as const;

export class AmazonMiner implements CatalogMiner {
  readonly store = "AMAZON" as const;
  readonly client: AmazonCreatorsClient | null;

  constructor(credentials: Partial<AmazonCredentials>, http?: typeof fetch) {
    const { credentialId, credentialSecret, partnerTag } = credentials;
    this.client =
      credentialId && credentialSecret && partnerTag
        ? new AmazonCreatorsClient({ credentialId, credentialSecret, partnerTag }, http)
        : null;
  }

  status(): MinerStatus {
    if (!this.client) return { enabled: false, reason: AMAZON_DISABLED_REASONS.missingCredentials };
    return { enabled: false, reason: AMAZON_DISABLED_REASONS.searchNotConfirmed };
  }

  async mine(): Promise<MineResult> {
    // Nunca chamado enquanto status() estiver desligado.
    throw new Error(AMAZON_DISABLED_REASONS.searchNotConfirmed);
  }

  async verify(): Promise<Map<string, MinedProduct | null>> {
    return new Map();
  }
}
