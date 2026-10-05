import { describe, expect, it } from "vitest";
import {
  AMAZON_REPORT_URL,
  amazonReportPeriod,
  amazonReportUrl,
  ASSOCIATES_PAGE_URL,
  associatesHeaders,
  parseAmazonReport,
  parseAssociatesSession,
  readAmazonReport,
  sessionFromParts,
} from "../src/amazon-report";

// Página do Associados no formato REAL (10/2026), com tokens e ids FALSOS.
const STATE = {
  roles: ["Primary"],
  language: "pt_BR",
  storeId: "cliente-20",
  locale: "pt_BR",
  marketplaceId: "A2Q3Y263D00KWC",
  customerId: "CLIENTEFALSO1",
  associateIdentityToken: "token.falso.de.teste",
  programId: "33",
};
const PAGE = `<html><head><meta name="csrf-token" content="csrf-falso"></head><body>
<div id="pageState" data-page-state="${JSON.stringify(STATE).replace(/"/g, "&quot;")}"></div></body></html>`;

// Formato REAL de GET /reporting/summary do Associados (10/2026), valores de exemplo.
const BODY = {
  interval: "DAY",
  last_updated: "01:37 Oct 05 2026 BRT",
  query: { type: "earning", start_date: "2026-09-05", end_date: "2026-10-04" },
  records: [{ day: "2026-10-03", clicks: "14", ordered_items: "8", total_earnings: "8.96" }],
  total: {
    table: {
      clicks: "64",
      ordered_items: "8",
      ordered_revenue: "150.56",
      shipped_items: "4",
      shipped_revenue: "68.96",
      returned_revenue: "0",
      total_earnings: "8.96",
      records: "12",
    },
  },
};

/** 05/10/2026 11:00 em São Paulo. */
const NOW = Date.parse("2026-10-05T14:00:00Z");
const TAG = "cliente-20";

describe("relatório da Amazon (Associados)", () => {
  it("período igual ao da página: últimos N dias até ontem; mesmo endereço do Associados", () => {
    expect(amazonReportPeriod(30, NOW)).toMatchObject({ startDate: "2026-09-05", endDate: "2026-10-04" });
    expect(amazonReportPeriod(7, NOW)).toMatchObject({ startDate: "2026-09-28", endDate: "2026-10-04" });
    const url = new URL(amazonReportUrl(TAG, 30, NOW));
    expect(`${url.origin}${url.pathname}`).toBe(AMAZON_REPORT_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      "query[start_date]": "2026-09-05",
      "query[end_date]": "2026-10-04",
      "query[type]": "earning",
      "query[storeId]": TAG,
      "query[locale]": "BR",
      store_id: TAG,
    });
  });

  it("lê cliques, pedidos, enviados, receita e ganhos do total", () => {
    expect(parseAmazonReport(BODY, 30, amazonReportPeriod(30, NOW))).toEqual({
      store: "AMAZON",
      rangeDays: 30,
      periodStart: "2026-09-05T03:00:00.000Z",
      periodEnd: "2026-10-05T03:00:00.000Z",
      clicks: 64,
      buyers: 0,
      orders: 8,
      units: 4,
      salesCents: 15056,
      notEffectiveSalesCents: 0,
      commissionCents: 896,
    });
  });

  it("lê a sessão da página (csrf-token e data-page-state) e monta os mesmos cabeçalhos da página", () => {
    const session = parseAssociatesSession(PAGE);
    expect(session).toEqual({
      csrfToken: "csrf-falso",
      identityToken: "token.falso.de.teste",
      customerId: "CLIENTEFALSO1",
      storeId: "cliente-20",
      marketplaceId: "A2Q3Y263D00KWC",
      programId: "33",
      role: "Primary",
      locale: "pt_BR",
    });
    expect(associatesHeaders(session)).toEqual({
      accept: "*/*",
      authorization: "Bearer token.falso.de.teste",
      customerid: "CLIENTEFALSO1",
      language: "pt_BR",
      locale: "pt_BR",
      marketplaceid: "A2Q3Y263D00KWC",
      programid: "33",
      roles: "Primary",
      storeid: "cliente-20",
      "x-csrf-token": "csrf-falso",
      "x-requested-with": "XMLHttpRequest",
    });
    expect(() => parseAssociatesSession("<html>login</html>")).toThrow("Entre na sua conta de Associados");
  });

  it("sessão lida da página já carregada (atributo já decodificado pelo navegador)", () => {
    expect(sessionFromParts("csrf-falso", JSON.stringify(STATE))).toEqual(parseAssociatesSession(PAGE));
    expect(() => sessionFromParts("", JSON.stringify(STATE))).toThrow("Entre na sua conta de Associados");
    expect(() => sessionFromParts("csrf", "{quebrado")).toThrow("mudou de formato");
  });

  it("fluxo completo: página do Associados -> relatório com os cabeçalhos da sessão", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const http = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: new Headers(init?.headers) });
      return url === ASSOCIATES_PAGE_URL ? new Response(PAGE) : new Response(JSON.stringify(BODY));
    }) as unknown as typeof fetch;
    const report = await readAmazonReport(http, TAG, 30, NOW);
    expect(report.clicks).toBe(64);
    expect(calls[0]!.url).toBe(ASSOCIATES_PAGE_URL);
    expect(calls[1]!.headers.get("authorization")).toBe("Bearer token.falso.de.teste");
    expect(calls[1]!.headers.get("x-csrf-token")).toBe("csrf-falso");
  });

  it("Chrome logado em OUTRA conta de Associados: não lê (números seriam de outra pessoa)", async () => {
    const http = (async () => new Response(PAGE)) as unknown as typeof fetch;
    await expect(readAmazonReport(http, "outra-20", 30, NOW)).rejects.toThrow("logado no Associados com outra conta");
  });

  it("sem login ou formato inesperado vira erro em pt-BR", async () => {
    expect(() => parseAmazonReport({ nada: 1 }, 7, amazonReportPeriod(7, NOW))).toThrow("formato inesperado");
    const html = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    await expect(readAmazonReport(html, TAG, 7, NOW)).rejects.toThrow("Entre na sua conta de Associados");
    const session = parseAssociatesSession(PAGE);
    const notJson = (async () => new Response("<html>erro</html>")) as unknown as typeof fetch;
    await expect(readAmazonReport(notJson, TAG, 7, NOW, session)).rejects.toThrow('não devolveu o relatório (HTTP 200: "<html>erro</html>")');
  });
});
