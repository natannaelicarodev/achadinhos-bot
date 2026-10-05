// Relatório da Amazon (painel de Associados do CLIENTE): cliques, itens pedidos, enviados,
// receita e ganhos de um período. Mesmo pedido da página Relatórios > Resumo do Associados
// (capturado em 10/2026, INTERNO): pode mudar sem aviso.
import { AmazonError } from "./amazon";

export const AMAZON_REPORT_URL = "https://associados.amazon.com.br/reporting/summary";
export const AMAZON_REPORT_RANGES = [7, 30] as const;

const SP_OFFSET_MS = -3 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const ymd = (instant: number) => new Date(instant + SP_OFFSET_MS).toISOString().slice(0, 10);

/** Últimos N dias até ONTEM (dia em São Paulo), como a página do Associados. */
export function amazonReportPeriod(rangeDays: number, now: number) {
  const local = now + SP_OFFSET_MS;
  const todayStart = local - (local % DAY_MS) - SP_OFFSET_MS; // hoje 00:00 em SP (UTC)
  const end = todayStart; // fim exclusivo: hoje 00:00
  const start = end - rangeDays * DAY_MS;
  return { start, end, startDate: ymd(start), endDate: ymd(end - DAY_MS) };
}

export function amazonReportUrl(storeId: string, rangeDays: number, now: number): string {
  const { startDate, endDate } = amazonReportPeriod(rangeDays, now);
  const query = new URLSearchParams({
    "query[start_date]": startDate,
    "query[end_date]": endDate,
    "query[type]": "earning",
    "query[storeId]": storeId,
    "query[locale]": "BR",
    store_id: storeId,
  });
  return `${AMAZON_REPORT_URL}?${query}`;
}

export interface AmazonReportSnapshot {
  store: "AMAZON";
  rangeDays: number;
  periodStart: string;
  periodEnd: string;
  clicks: number;
  /** A Amazon não informa compradores. */
  buyers: number;
  /** "Pedidos" (itens pedidos). */
  orders: number;
  /** "Enviados" (itens enviados). */
  units: number;
  /** Receita dos itens pedidos. */
  salesCents: number;
  /** Receita devolvida. */
  notEffectiveSalesCents: number;
  /** "Ganhos". */
  commissionCents: number;
}

const num = (value: unknown) => {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** Converte a resposta do Associados (formato real de 10/2026: total.table com textos numéricos). */
export function parseAmazonReport(body: unknown, rangeDays: number, period: { start: number; end: number }): AmazonReportSnapshot {
  const table = (body as { total?: { table?: Record<string, unknown> } } | null)?.total?.table;
  if (!table || typeof table !== "object") throw new AmazonError("A Amazon respondeu o relatório num formato inesperado.");
  return {
    store: "AMAZON",
    rangeDays,
    periodStart: new Date(period.start).toISOString(),
    periodEnd: new Date(period.end).toISOString(),
    clicks: Math.round(num(table.clicks)),
    buyers: 0,
    orders: Math.round(num(table.ordered_items)),
    units: Math.round(num(table.shipped_items)),
    salesCents: Math.round(num(table.ordered_revenue) * 100),
    notEffectiveSalesCents: Math.round(num(table.returned_revenue) * 100),
    commissionCents: Math.round(num(table.total_earnings) * 100),
  };
}

// ---------- Sessão do Associados (lida da própria página, no navegador do cliente) ----------

/** Página do Associados de onde a sessão é lida (csrf-token e data-page-state). */
export const ASSOCIATES_PAGE_URL = "https://associados.amazon.com.br/p/reporting/earnings";

export interface AssociatesSession {
  csrfToken: string;
  /** associateIdentityToken: vai no Authorization (Bearer). */
  identityToken: string;
  customerId: string;
  storeId: string;
  marketplaceId: string;
  programId: string;
  role: string;
  locale: string;
}

const decodeHtml = (text: string) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const NOT_LOGGED = "Entre na sua conta de Associados da Amazon neste Chrome para ler o relatório.";

/**
 * Lê da página do Associados (formato de 10/2026): <meta name="csrf-token" content="...">
 * e <div id="pageState" data-page-state="{...JSON...}"> (associateIdentityToken, customerId...).
 */
export function parseAssociatesSession(html: string): AssociatesSession {
  const csrfToken = html.match(/<meta[^>]+name="csrf-token"[^>]+content="([^"]+)"/)?.[1] ?? html.match(/<meta[^>]+content="([^"]+)"[^>]+name="csrf-token"/)?.[1];
  const rawState = html.match(/id="pageState"[^>]*data-page-state="([^"]*)"/)?.[1] ?? html.match(/data-page-state="([^"]*)"[^>]*id="pageState"/)?.[1];
  if (!csrfToken || !rawState) throw new AmazonError(NOT_LOGGED);
  return sessionFromParts(decodeHtml(csrfToken), decodeHtml(rawState));
}

/** Sessão a partir do csrf-token e do JSON do pageState (lidos da página já carregada). */
export function sessionFromParts(csrfToken: string, pageStateJson: string): AssociatesSession {
  if (!csrfToken || !pageStateJson) throw new AmazonError(NOT_LOGGED);
  let state: Record<string, unknown>;
  try {
    state = JSON.parse(pageStateJson) as Record<string, unknown>;
  } catch {
    throw new AmazonError("A página do Associados mudou de formato: não consegui ler a sessão.");
  }
  const str = (key: string) => (typeof state[key] === "string" ? (state[key] as string) : "");
  const roles = Array.isArray(state.roles) ? state.roles.filter((r): r is string => typeof r === "string") : [];
  const session: AssociatesSession = {
    csrfToken,
    identityToken: str("associateIdentityToken"),
    customerId: str("customerId"),
    storeId: str("storeId"),
    marketplaceId: str("marketplaceId"),
    programId: typeof state.programId === "number" ? String(state.programId) : str("programId"),
    role: roles[0] ?? "Primary",
    locale: str("locale") || "pt_BR",
  };
  if (!session.identityToken || !session.storeId) throw new AmazonError(NOT_LOGGED);
  return session;
}

export async function readAssociatesSession(http: typeof fetch): Promise<AssociatesSession> {
  const response = await http(ASSOCIATES_PAGE_URL, { headers: { accept: "text/html" } });
  if (/\/ap\/signin/.test(response.url)) throw new AmazonError(NOT_LOGGED, response.status);
  if (!response.ok) throw new AmazonError(`A Amazon não abriu o Associados (HTTP ${response.status}).`, response.status);
  return parseAssociatesSession(await response.text());
}

/** Os mesmos cabeçalhos que a página do Associados manda no pedido do relatório. */
export function associatesHeaders(session: AssociatesSession): Record<string, string> {
  return {
    accept: "*/*",
    authorization: `Bearer ${session.identityToken}`,
    customerid: session.customerId,
    language: session.locale,
    locale: session.locale,
    marketplaceid: session.marketplaceId,
    programid: session.programId,
    roles: session.role,
    storeid: session.storeId,
    "x-csrf-token": session.csrfToken,
    "x-requested-with": "XMLHttpRequest",
  };
}

/**
 * Relatório do período. `expectedStoreId` = etiqueta da credencial do cliente: se o Chrome
 * estiver logado em OUTRA conta de Associados, não lê (os números seriam de outra pessoa).
 */
export async function readAmazonReport(
  http: typeof fetch,
  expectedStoreId: string,
  rangeDays: number,
  now: number,
  session?: AssociatesSession,
): Promise<AmazonReportSnapshot> {
  const s = session ?? (await readAssociatesSession(http));
  if (s.storeId.toLowerCase() !== expectedStoreId.toLowerCase()) {
    throw new AmazonError(
      `Este Chrome está logado no Associados com outra conta (${s.storeId}); a etiqueta em Credenciais é ${expectedStoreId}.`,
    );
  }
  const response = await http(amazonReportUrl(s.storeId, rangeDays, now), { headers: associatesHeaders(s) });
  if (response.status === 401 || response.status === 403 || /\/ap\/signin/.test(response.url)) {
    throw new AmazonError("Entre na sua conta de Associados da Amazon neste Chrome para ler o relatório.", response.status);
  }
  if (!response.ok) throw new AmazonError(`A Amazon não abriu o relatório (HTTP ${response.status}).`, response.status);
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // Detalhe para o diagnóstico (sem dados da sessão): tipo da resposta e começo do texto.
    const hint = text.replace(/\s+/g, " ").trim().slice(0, 80);
    throw new AmazonError(
      `A Amazon não devolveu o relatório (HTTP ${response.status}${hint ? `: "${hint}"` : ""}). Confira o login no Associados neste Chrome.`,
      response.status,
    );
  }
  return parseAmazonReport(body, rangeDays, amazonReportPeriod(rangeDays, now));
}
