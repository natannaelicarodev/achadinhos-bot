import { describe, expect, it } from "vitest";
import { dashboardUrl, ML_DASHBOARD_URL, parseDashboard, readMlReport, reportPeriod } from "../src/ml-report";

// Formato REAL da resposta de /affiliate-program/api/dashboard/general (10/2026), valores de exemplo.
const BODY = {
  commissions: [
    { id: "summary", current_amount: 242.97, variation: 115, variation_indicator: "INCREASE", data: [] },
    { id: "marketplace", current_amount: 233.59, variation: 96.14, variation_indicator: "SUMMARY" },
    { id: "seller", current_amount: 9.38, variation: 3.86, variation_indicator: "SUMMARY" },
  ],
  data: [
    { id: "clicks", current_amount: 147, variation: 130, variation_indicator: "INCREASE" },
    { id: "buyers", current_amount: 5, variation: 25, variation_indicator: "INCREASE" },
    { id: "requests", current_amount: 11, variation: 22, variation_indicator: "INCREASE" },
    { id: "orders", current_amount: 12, variation: 33, variation_indicator: "INCREASE" },
    { id: "sales", current_amount: 2037.19, variation: 99, variation_indicator: "INCREASE" },
  ],
  filter_time_range: "1788566400000--1791158400000",
  filter_type: "GENERAL",
  sales: [
    { id: "total_gross_sales", current_amount: 2037.19 },
    { id: "total_estimated_sales", current_amount: 2037.19 },
    { id: "total_not_effective_sales", current_amount: 0 },
    { id: "count_not_effective_sales", current_amount: 0 },
  ],
  show_modal_new_metrics: false,
};

/** 05/10/2026 11:00 em São Paulo. */
const NOW = Date.parse("2026-10-05T14:00:00Z");

describe("relatório do Mercado Livre (painel de afiliados)", () => {
  it("período igual ao da página: últimos N dias até hoje 00:00 em São Paulo", () => {
    const p = reportPeriod(30, NOW);
    expect(p.filter).toBe("2026-09-05T00:00:00.000-03:00--2026-10-05T00:00:00.000-03:00");
    expect(new Date(p.end).toISOString()).toBe("2026-10-05T03:00:00.000Z");
    expect(reportPeriod(7, NOW).filter).toBe("2026-09-28T00:00:00.000-03:00--2026-10-05T00:00:00.000-03:00");
    const url = new URL(dashboardUrl(30, NOW));
    expect(`${url.origin}${url.pathname}`).toBe(ML_DASHBOARD_URL);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ metric_tab: "general", type: "GENERAL", page: "1" });
  });

  it("lê cliques, compradores, pedidos, unidades, vendas e ganho", () => {
    expect(parseDashboard(BODY, 30, reportPeriod(30, NOW))).toEqual({
      store: "MERCADO_LIVRE",
      rangeDays: 30,
      periodStart: "2026-09-05T03:00:00.000Z",
      periodEnd: "2026-10-05T03:00:00.000Z",
      clicks: 147,
      buyers: 5,
      orders: 11,
      units: 12,
      salesCents: 203719,
      notEffectiveSalesCents: 0,
      commissionCents: 24297,
    });
  });

  it("formato inesperado ou sem login vira erro em pt-BR", async () => {
    expect(() => parseDashboard({ nada: true }, 7, reportPeriod(7, NOW))).toThrow("formato inesperado");
    const notLogged = (async () => new Response("<html>login</html>", { status: 200 })) as unknown as typeof fetch;
    await expect(readMlReport(notLogged, 7, NOW)).rejects.toThrow("Entre na sua conta do Mercado Livre");
    const refused = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;
    await expect(readMlReport(refused, 7, NOW)).rejects.toThrow("Entre na sua conta");
  });
});
