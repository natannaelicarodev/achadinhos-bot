// Relatório de vendas (conversões) da Shopee com a credencial DO CLIENTE: são os dados dele.
// A API NÃO tem relatório de cliques (conferido no esquema GraphQL em 10/2026); só conversões.
// Cada conversão traz em `utmContent` os subIds que mandamos no link ([tenant, grupo]).
import { ShopeeApiError, ShopeeGraphqlClient, type ShopeeClientOptions } from "./client";

export interface ShopeeOrderConversion {
  orderId: string;
  conversionId: string;
  /** subIds do link (ordem em que foram enviados). */
  subIds: string[];
  status: string | null;
  purchasedAt: Date;
  clickedAt: Date | null;
  /** Primeiro item do pedido (para ligar à oferta). */
  itemId: string | null;
  amountCents: number;
  commissionCents: number;
}

const toCents = (value: unknown) => {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const toDate = (seconds: unknown) => (typeof seconds === "number" && seconds > 0 ? new Date(seconds * 1000) : null);

/** "tenant-grupo" (a Shopee junta os subIds com hífen; nossos ids não têm hífen). */
export function parseSubIds(utmContent: unknown): string[] {
  return typeof utmContent === "string" ? utmContent.split("-").map((s) => s.trim()).filter(Boolean) : [];
}

interface RawItem {
  itemId?: number;
  actualAmount?: string;
  itemTotalCommission?: string;
}
interface RawNode {
  purchaseTime?: number;
  clickTime?: number;
  conversionId?: number;
  conversionStatus?: string;
  utmContent?: string;
  orders?: { orderId?: string; orderStatus?: string; items?: RawItem[] }[];
}

/** Um pedido por linha (uma conversão pode ter vários pedidos). */
export function conversionsFromNodes(nodes: RawNode[]): ShopeeOrderConversion[] {
  const result: ShopeeOrderConversion[] = [];
  for (const node of nodes) {
    const purchasedAt = toDate(node.purchaseTime);
    if (!purchasedAt) continue;
    for (const order of node.orders ?? []) {
      if (!order.orderId) continue;
      const items = order.items ?? [];
      result.push({
        orderId: order.orderId,
        conversionId: String(node.conversionId ?? ""),
        subIds: parseSubIds(node.utmContent),
        status: order.orderStatus ?? node.conversionStatus ?? null,
        purchasedAt,
        clickedAt: toDate(node.clickTime),
        itemId: items[0]?.itemId !== undefined ? String(items[0].itemId) : null,
        amountCents: items.reduce((sum, item) => sum + toCents(item.actualAmount), 0),
        commissionCents: items.reduce((sum, item) => sum + toCents(item.itemTotalCommission), 0),
      });
    }
  }
  return result;
}

const QUERY = (start: number, end: number, scrollId: string | null) => `{
  conversionReport(purchaseTimeStart: ${start}, purchaseTimeEnd: ${end}, limit: 500${scrollId ? `, scrollId: ${JSON.stringify(scrollId)}` : ""}) {
    nodes {
      purchaseTime clickTime conversionId conversionStatus utmContent
      orders { orderId orderStatus items { itemId actualAmount itemTotalCommission } }
    }
    pageInfo { hasNextPage scrollId }
  }
}`;

/** Leitura do relatório de vendas do CLIENTE (credencial dele; nada de link aqui). */
export class ShopeeReportReader {
  private readonly client: ShopeeGraphqlClient;

  constructor(options: ShopeeClientOptions) {
    this.client = new ShopeeGraphqlClient(options);
  }

  /** Vendas com compra entre `start` e `end` (todas as páginas, até `maxPages`). */
  async conversions(start: Date, end: Date, maxPages = 20): Promise<ShopeeOrderConversion[]> {
    const from = Math.floor(start.getTime() / 1000);
    const to = Math.floor(end.getTime() / 1000);
    const all: ShopeeOrderConversion[] = [];
    let scrollId: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const data = (await this.client.request(QUERY(from, to, scrollId))) as {
        conversionReport?: { nodes?: RawNode[]; pageInfo?: { hasNextPage?: boolean; scrollId?: string } };
      };
      const report = data.conversionReport;
      if (!report) throw new ShopeeApiError("A Shopee não devolveu o relatório de vendas.");
      all.push(...conversionsFromNodes(report.nodes ?? []));
      if (!report.pageInfo?.hasNextPage || !report.pageInfo.scrollId) break;
      scrollId = report.pageInfo.scrollId;
    }
    return all;
  }
}
