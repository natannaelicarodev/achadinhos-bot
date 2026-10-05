// Modelo de mensagem do tenant (servidor: painel e worker usam o mesmo).
import { forTenant, type PrismaClient } from "@achadinhos/db";
import { DEFAULT_HEADLINE, DEFAULT_MESSAGE_TEMPLATE, messageVariables, renderMessage } from "./message";

export interface MessageSettings {
  body: string;
  headline: string;
  /** Headline automática pelo tipo do produto (dicionário). */
  autoHeadlines: boolean;
  /** Headlines próprias do cliente. */
  customHeadlines: string[];
  isDefault: boolean;
}

export async function getMessageSettings(tenantId: string, options: { client?: PrismaClient } = {}): Promise<MessageSettings> {
  const row = await forTenant(tenantId, options.client).messageTemplate.findUnique({ where: { tenantId } });
  return row
    ? {
        body: row.body,
        headline: row.headline,
        autoHeadlines: row.autoHeadlines,
        customHeadlines: row.customHeadlines,
        isDefault: false,
      }
    : { body: DEFAULT_MESSAGE_TEMPLATE, headline: DEFAULT_HEADLINE, autoHeadlines: true, customHeadlines: [], isDefault: true };
}

export interface ShareProduct {
  title: string;
  priceCents: number | null;
  originalPriceCents: number | null;
  discountPct: number | null;
}

export function composeMessage(settings: { body: string }, product: ShareProduct, link: string, headline: string): string {
  return renderMessage(settings.body, messageVariables(product, link, headline));
}
