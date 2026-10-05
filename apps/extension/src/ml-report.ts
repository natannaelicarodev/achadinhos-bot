// Relatório do Mercado Livre (painel de afiliados do CLIENTE): cliques, compradores, pedidos,
// unidades, vendas e ganho de um período. Mesmo pedido da página "Métricas" do portal
// (capturado em 10/2026, INTERNO): pode mudar sem aviso.
import { MlError } from "./ml";

export const ML_DASHBOARD_URL = "https://www.mercadolivre.com.br/affiliate-program/api/dashboard/general";
export const ML_REPORT_RANGES = [7, 30] as const;

/** São Paulo não tem horário de verão: -03:00 fixo (é o formato que o portal usa). */
const SP_OFFSET_MS = -3 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

const pad = (n: number) => String(n).padStart(2, "0");
/** "2026-10-05T00:00:00.000-03:00" de um instante que já é meia-noite em São Paulo. */
function spMidnightIso(instant: number): string {
  const local = new Date(instant + SP_OFFSET_MS);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T00:00:00.000-03:00`;
}

/** Últimos N dias até hoje 00:00 (São Paulo), como a página do portal. */
export function reportPeriod(rangeDays: number, now: number): { start: number; end: number; filter: string } {
  const local = now + SP_OFFSET_MS;
  const end = local - (local % DAY_MS) - SP_OFFSET_MS;
  const start = end - rangeDays * DAY_MS;
  return { start, end, filter: `${spMidnightIso(start)}--${spMidnightIso(end)}` };
}

export function dashboardUrl(rangeDays: number, now: number): string {
  const { filter } = reportPeriod(rangeDays, now);
  const query = new URLSearchParams({ filter_time_range: filter, metric_tab: "general", type: "GENERAL", page: "1", _t: String(now) });
  return `${ML_DASHBOARD_URL}?${query}`;
}

export interface MlReportSnapshot {
  store: "MERCADO_LIVRE";
  rangeDays: number;
  periodStart: string;
  periodEnd: string;
  clicks: number;
  buyers: number;
  /** "Ordens estimadas" (pedidos). */
  orders: number;
  /** "Prod. estimados" (unidades). */
  units: number;
  salesCents: number;
  notEffectiveSalesCents: number;
  /** "Ganho estimado". */
  commissionCents: number;
}

type Metric = { id?: unknown; current_amount?: unknown };
const amount = (list: unknown, id: string): number => {
  const found = Array.isArray(list) ? (list as Metric[]).find((m) => m?.id === id) : undefined;
  return typeof found?.current_amount === "number" && Number.isFinite(found.current_amount) ? found.current_amount : 0;
};
const cents = (value: number) => Math.round(value * 100);

/** Converte a resposta do portal (formato real de 10/2026). */
export function parseDashboard(body: unknown, rangeDays: number, period: { start: number; end: number }): MlReportSnapshot {
  if (!body || typeof body !== "object" || !Array.isArray((body as { data?: unknown }).data)) {
    throw new MlError("O Mercado Livre respondeu o relatório num formato inesperado.");
  }
  const b = body as { data: unknown; commissions?: unknown; sales?: unknown };
  return {
    store: "MERCADO_LIVRE",
    rangeDays,
    periodStart: new Date(period.start).toISOString(),
    periodEnd: new Date(period.end).toISOString(),
    clicks: Math.round(amount(b.data, "clicks")),
    buyers: Math.round(amount(b.data, "buyers")),
    orders: Math.round(amount(b.data, "requests")),
    units: Math.round(amount(b.data, "orders")),
    salesCents: cents(amount(b.data, "sales")),
    notEffectiveSalesCents: cents(amount(b.sales, "total_not_effective_sales")),
    commissionCents: cents(amount(b.commissions, "summary")),
  };
}

export async function readMlReport(http: typeof fetch, rangeDays: number, now: number): Promise<MlReportSnapshot> {
  const response = await http(dashboardUrl(rangeDays, now), { headers: { accept: "application/json" } });
  if (response.status === 401 || response.status === 403) {
    throw new MlError("Entre na sua conta do Mercado Livre neste Chrome para ler o relatório de afiliados.", response.status);
  }
  if (!response.ok) throw new MlError(`O Mercado Livre não abriu o relatório (HTTP ${response.status}).`, response.status);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new MlError("Entre na sua conta do Mercado Livre neste Chrome para ler o relatório de afiliados.");
  }
  return parseDashboard(body, rangeDays, reportPeriod(rangeDays, now));
}
