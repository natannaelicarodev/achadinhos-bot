// Cliente da API v3 do Asaas (cobrança recorrente: Pix, boleto e cartão).
// Cartão NUNCA passa por nós: o cliente paga na página de pagamento do Asaas (invoiceUrl).
// Autenticação: header `access_token` com a chave de API da conta (ASAAS_API_KEY).
import { z } from "zod";

export const ASAAS_BASE_URLS = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  production: "https://api.asaas.com/v3",
} as const;
export type AsaasEnv = keyof typeof ASAAS_BASE_URLS;

export class AsaasError extends Error {
  override name = "AsaasError";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Cobrança como o Asaas devolve (só os campos que usamos). */
export const asaasPaymentSchema = z.object({
  id: z.string(),
  customer: z.string(),
  subscription: z.string().nullish(),
  status: z.string(),
  billingType: z.string().nullish(),
  value: z.number(),
  dueDate: z.string(),
  paymentDate: z.string().nullish(),
  clientPaymentDate: z.string().nullish(),
  confirmedDate: z.string().nullish(),
  invoiceUrl: z.string().nullish(),
  deleted: z.boolean().optional(),
  externalReference: z.string().nullish(),
});
export type AsaasPayment = z.infer<typeof asaasPaymentSchema>;

/** Assinatura como o Asaas devolve (só os campos que usamos). */
export const asaasSubscriptionSchema = z.object({
  id: z.string(),
  customer: z.string(),
  status: z.string().nullish(), // ACTIVE, INACTIVE, EXPIRED
  deleted: z.boolean().optional(),
  value: z.number().optional(),
});
export type AsaasSubscription = z.infer<typeof asaasSubscriptionSchema>;
const subscriptionListSchema = z.object({ data: z.array(asaasSubscriptionSchema) });

const idSchema = z.object({ id: z.string() });
const listSchema = z.object({ data: z.array(asaasPaymentSchema), hasMore: z.boolean().optional() });
const errorSchema = z.object({ errors: z.array(z.object({ description: z.string() })).min(1) });

export type AsaasCycle = "MONTHLY" | "YEARLY";

export interface AsaasClientOptions {
  apiKey: string;
  env: AsaasEnv;
  fetch?: typeof fetch;
}

export class AsaasClient {
  private readonly base: string;
  private readonly http: typeof fetch;

  constructor(private readonly options: AsaasClientOptions) {
    this.base = ASAAS_BASE_URLS[options.env];
    this.http = options.fetch ?? fetch;
  }

  private async request<T>(method: string, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.http(`${this.base}${path}`, {
        method,
        headers: {
          access_token: this.options.apiKey,
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": "achadinhos-bot",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new AsaasError("Não foi possível falar com o Asaas agora. Tente de novo em instantes.");
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const parsed = errorSchema.safeParse(json);
      if (response.status === 401) throw new AsaasError("Chave de API do Asaas inválida (ASAAS_API_KEY).", 401);
      throw new AsaasError(parsed.success ? parsed.data.errors[0]!.description : `O Asaas recusou o pedido (HTTP ${response.status}).`, response.status);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new AsaasError("O Asaas devolveu uma resposta inesperada.", response.status);
    return parsed.data;
  }

  createCustomer(input: { name: string; cpfCnpj: string; email: string; externalReference: string }) {
    return this.request("POST", "/customers", idSchema, input);
  }

  /** billingType UNDEFINED: o cliente escolhe Pix, boleto ou cartão na página de pagamento. */
  createSubscription(input: {
    customer: string;
    value: number;
    nextDueDate: string;
    cycle: AsaasCycle;
    description: string;
    externalReference: string;
  }) {
    return this.request("POST", "/subscriptions", idSchema, { billingType: "UNDEFINED", ...input });
  }

  /** Muda o valor das próximas cobranças (e das pendentes já geradas). */
  updateSubscriptionValue(id: string, value: number) {
    return this.request("POST", `/subscriptions/${encodeURIComponent(id)}`, idSchema, { value, updatePendingPayments: true });
  }

  /** Cancela no Asaas: não gera novas cobranças. */
  deleteSubscription(id: string) {
    return this.request("DELETE", `/subscriptions/${encodeURIComponent(id)}`, z.unknown());
  }

  /** Cobrança avulsa (diferença da troca de plano). */
  createPayment(input: { customer: string; value: number; dueDate: string; description: string; externalReference: string }) {
    return this.request("POST", "/payments", asaasPaymentSchema, { billingType: "UNDEFINED", ...input });
  }

  deletePayment(id: string) {
    return this.request("DELETE", `/payments/${encodeURIComponent(id)}`, z.unknown());
  }

  getPayment(id: string) {
    return this.request("GET", `/payments/${encodeURIComponent(id)}`, asaasPaymentSchema);
  }

  /** Estorno (total) de uma cobrança paga. */
  refundPayment(id: string, description: string) {
    return this.request("POST", `/payments/${encodeURIComponent(id)}/refund`, asaasPaymentSchema, { description });
  }

  /** Assinaturas do cliente no Asaas (para achar assinatura "órfã" que ainda cobraria). */
  async listCustomerSubscriptions(customer: string): Promise<AsaasSubscription[]> {
    const query = new URLSearchParams({ customer, limit: "100", offset: "0" });
    const result = await this.request("GET", `/subscriptions?${query}`, subscriptionListSchema);
    return result.data;
  }

  /** Todas as cobranças do cliente (assinatura e avulsas), página a página. */
  async listCustomerPayments(customer: string, maxPages = 10): Promise<AsaasPayment[]> {
    const all: AsaasPayment[] = [];
    for (let page = 0; page < maxPages; page++) {
      const query = new URLSearchParams({ customer, limit: "100", offset: String(page * 100) });
      const result = await this.request("GET", `/payments?${query}`, listSchema);
      all.push(...result.data);
      if (!result.hasMore) break;
    }
    return all;
  }
}

/** Cliente do Asaas a partir do ambiente (null = cobrança não configurada). */
export function asaasFromEnv(env: Record<string, string | undefined> = process.env, http?: typeof fetch): AsaasClient | null {
  const apiKey = env.ASAAS_API_KEY?.trim();
  if (!apiKey) return null;
  const mode: AsaasEnv = env.ASAAS_ENV === "production" ? "production" : "sandbox";
  return new AsaasClient({ apiKey, env: mode, ...(http ? { fetch: http } : {}) });
}
