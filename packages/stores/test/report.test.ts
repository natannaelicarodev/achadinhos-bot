import { describe, expect, it } from "vitest";
import { conversionsFromNodes, parseSubIds, ShopeeReportReader } from "../src/shopee/report";

const node = (extra: Record<string, unknown> = {}) => ({
  purchaseTime: 1_791_000_000,
  clickTime: 1_790_999_000,
  conversionId: 123,
  conversionStatus: "PENDING",
  utmContent: "tenantA-grupo1",
  orders: [
    {
      orderId: "250101ABC",
      orderStatus: "PENDING",
      items: [
        { itemId: 22_334_455, actualAmount: "59.90", itemTotalCommission: "4.79" },
        { itemId: 99, actualAmount: "10.10", itemTotalCommission: "0.81" },
      ],
    },
  ],
  ...extra,
});

describe("Shopee: relatório de vendas (credencial do cliente)", () => {
  it("um pedido por linha: subIds, valor e comissão somados em centavos, horários do clique e da compra", () => {
    expect(conversionsFromNodes([node()])).toEqual([
      {
        orderId: "250101ABC",
        conversionId: "123",
        subIds: ["tenantA", "grupo1"],
        status: "PENDING",
        purchasedAt: new Date(1_791_000_000_000),
        clickedAt: new Date(1_790_999_000_000),
        itemId: "22334455",
        amountCents: 7000,
        commissionCents: 560,
      },
    ]);
  });

  it("subIds vazios, pedido sem id e compra sem data são tratados", () => {
    expect(parseSubIds("")).toEqual([]);
    expect(parseSubIds(undefined)).toEqual([]);
    expect(parseSubIds("a--b-")).toEqual(["a", "b"]);
    expect(conversionsFromNodes([node({ orders: [{ items: [] }] }), node({ purchaseTime: 0 })])).toEqual([]);
  });

  it("percorre as páginas pelo scrollId", async () => {
    const queries: string[] = [];
    const pages = [
      { nodes: [node()], pageInfo: { hasNextPage: true, scrollId: "abc" } },
      { nodes: [node({ orders: [{ orderId: "2", items: [] }] })], pageInfo: { hasNextPage: false } },
    ];
    const http = (async (_url: string, init: RequestInit) => {
      queries.push(JSON.parse(String(init.body)).query as string);
      return new Response(JSON.stringify({ data: { conversionReport: pages[queries.length - 1] } }));
    }) as unknown as typeof fetch;
    const reader = new ShopeeReportReader({ appId: "123", secret: "s", fetch: http, now: () => 1 });
    const rows = await reader.conversions(new Date(0), new Date(1_000));
    expect(rows.map((r) => r.orderId)).toEqual(["250101ABC", "2"]);
    expect(queries[0]).not.toContain("scrollId:");
    expect(queries[1]).toContain('scrollId: "abc"');
  });
});
