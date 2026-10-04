// Geração de link de afiliado da Shopee com a credencial DO CLIENTE.
// A credencial central nunca chega aqui: este tipo só é criado a partir das
// credenciais salvas pelo tenant (StoreCredential).
import { z } from "zod";
import { ShopeeApiError, ShopeeGraphqlClient, type ShopeeClientOptions } from "./client";

/** subId: só letras e números, até 50 caracteres (a Shopee aceita até 5). */
export function sanitizeSubId(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").slice(0, 50);
}

const shortLinkSchema = z.object({ generateShortLink: z.object({ shortLink: z.string().url() }) });

export class ShopeeLinkGenerator {
  private readonly client: ShopeeGraphqlClient;

  constructor(options: ShopeeClientOptions) {
    this.client = new ShopeeGraphqlClient(options);
  }

  async generateShortLink(originUrl: string, subIds: string[] = []): Promise<string> {
    const ids = subIds.map(sanitizeSubId).filter(Boolean).slice(0, 5);
    const input = [`originUrl: ${JSON.stringify(originUrl)}`];
    if (ids.length) input.push(`subIds: ${JSON.stringify(ids)}`);
    const data = await this.client.request(`mutation { generateShortLink(input: { ${input.join(", ")} }) { shortLink } }`);
    const parsed = shortLinkSchema.safeParse(data);
    if (!parsed.success) throw new ShopeeApiError("Resposta inesperada da Shopee (generateShortLink).");
    return parsed.data.generateShortLink.shortLink;
  }

  /** "Testar": gera um link de verdade para a página inicial. Erro = credencial inválida. */
  async test(): Promise<void> {
    await this.generateShortLink("https://shopee.com.br/", ["teste"]);
  }
}

/** Mensagem em pt-BR para erros da Shopee mostrados ao cliente. */
export function shopeeErrorMessage(error: unknown): string {
  if (error instanceof ShopeeApiError) {
    if (/signature|credential|auth|app ?id/i.test(error.message) || error.code === 10020) {
      return "A Shopee recusou o AppID ou a Senha da API. Confira os dados no portal de afiliados.";
    }
    return `A Shopee respondeu: ${error.message}`;
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "A Shopee demorou para responder. Tente de novo.";
  }
  return "Não foi possível falar com a Shopee agora. Tente de novo.";
}
