// Relatórios (fase 8): período, agregações de cliques e vendas, acesso por plano e CSV.
// Tudo por tenant (TenantDb de forTenant). Cliques = só os do nosso link /o/ ("Contar cliques por grupo").
import { PLANS, planAllowsSending, type ReportsLevel, type Store, type TenantDb } from "@achadinhos/db";

// ---------- Período ----------

const DAY_MS = 24 * 60 * 60_000;
/** São Paulo não tem horário de verão desde 2019: o dia local começa às 03:00 UTC. */
const SP_OFFSET = "-03:00";
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });

/** "AAAA-MM-DD" do dia em São Paulo. */
export const spDayKey = (date: Date) => dayKeyFormat.format(date);
const startOfSpDay = (key: string) => new Date(`${key}T00:00:00${SP_OFFSET}`);
const addDays = (key: string, days: number) => spDayKey(new Date(startOfSpDay(key).getTime() + days * DAY_MS + 12 * 3_600_000));

export const PERIOD_PRESETS = [7, 30, 90] as const;
export const MAX_PERIOD_DAYS = 366;

export interface ReportPeriod {
  from: Date;
  /** Exclusivo. */
  to: Date;
  /** Dias do período (AAAA-MM-DD, São Paulo), do mais antigo ao mais novo. */
  days: string[];
  /** Parâmetros da URL (para links e exportação). */
  query: Record<string, string>;
  label: string;
  preset: number | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const shortDate = (key: string) => key.split("-").reverse().join("/");

/** Lê `periodo` (7/30/90) ou `de`/`ate` (AAAA-MM-DD). Inválido -> 30 dias. */
export function parsePeriod(params: Record<string, string | string[] | undefined>, now: Date = new Date()): ReportPeriod {
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const today = spDayKey(now);
  const de = one("de");
  const ate = one("ate");
  if (de && ate && DATE_RE.test(de) && DATE_RE.test(ate) && !Number.isNaN(startOfSpDay(de).getTime()) && !Number.isNaN(startOfSpDay(ate).getTime())) {
    const end = ate > today ? today : ate;
    const span = Math.round((startOfSpDay(end).getTime() - startOfSpDay(de).getTime()) / DAY_MS) + 1;
    if (de <= end && span <= MAX_PERIOD_DAYS) {
      return build(de, end, { de, ate: end }, `${shortDate(de)} a ${shortDate(end)}`, null);
    }
  }
  const preset = PERIOD_PRESETS.find((p) => String(p) === one("periodo")) ?? 30;
  return build(addDays(today, -(preset - 1)), today, { periodo: String(preset) }, `Últimos ${preset} dias`, preset);

  function build(first: string, last: string, query: Record<string, string>, label: string, presetDays: number | null): ReportPeriod {
    const days: string[] = [];
    for (let key = first; key <= last; key = addDays(key, 1)) days.push(key);
    return { from: startOfSpDay(first), to: startOfSpDay(addDays(last, 1)), days, query, label, preset: presetDays };
  }
}

// ---------- Acesso por plano ----------

const LEVEL_RANK: Record<ReportsLevel, number> = { BASIC: 0, GROUPS: 1, FULL: 2 };

/** O que cada nível libera (Iniciante = BASIC, Pro = GROUPS, Agência = FULL). */
export const REPORT_FEATURES = {
  daily: "BASIC", // cliques por dia
  stores: "BASIC", // cliques por loja + cartões das lojas
  shopeeGroups: "BASIC", // vendas da Shopee por grupo
  groups: "GROUPS", // cliques por grupo + taxa de cliques
  offers: "GROUPS", // cliques por oferta + ofertas que mais venderam
  csv: "FULL", // exportar CSV
} as const satisfies Record<string, ReportsLevel>;
export type ReportFeature = keyof typeof REPORT_FEATURES;

export const canSee = (level: ReportsLevel, feature: ReportFeature) => LEVEL_RANK[level] >= LEVEL_RANK[REPORT_FEATURES[feature]];

/** Nome do plano mais barato (com envio) que libera o recurso: "Pro", "Agência"... */
export function planNameFor(feature: ReportFeature): string {
  const need = LEVEL_RANK[REPORT_FEATURES[feature]];
  const plan = [...PLANS]
    .filter((p) => planAllowsSending(p))
    .sort((a, b) => a.priceCents - b.priceCents)
    .find((p) => LEVEL_RANK[p.reportsLevel] >= need);
  return plan?.name ?? "superior";
}

// ---------- Dados ----------

/** Status da loja -> grupo simples (Shopee: COMPLETED, PENDING, CANCELLED...). */
export function statusKind(status: string | null): "done" | "canceled" | "pending" {
  if (status && /complet|conclu|valid|paid_out/i.test(status)) return "done";
  if (status && /cancel|invalid|fraud|refund|return|unpaid/i.test(status)) return "canceled";
  return "pending";
}

export interface SalesTotals {
  orders: number;
  amountCents: number;
  commissionCents: number;
  pendingCents: number;
  canceled: number;
}
const emptySales = (): SalesTotals => ({ orders: 0, amountCents: 0, commissionCents: 0, pendingCents: 0, canceled: 0 });

function addSale(t: SalesTotals, c: { amountCents: number; commissionCents: number; status: string | null }) {
  const kind = statusKind(c.status);
  if (kind === "canceled") {
    t.canceled += 1;
    return;
  }
  t.orders += 1;
  t.amountCents += c.amountCents;
  if (kind === "done") t.commissionCents += c.commissionCents;
  else t.pendingCents += c.commissionCents;
}

export interface GroupRate {
  groupId: string;
  name: string;
  messages: number;
  clicks: number;
  members: number | null;
  clicksPerMessage: number | null;
  /** Aproximado: cliques ÷ (mensagens × membros), em %. */
  pctMembers: number | null;
}

export interface ReportData {
  clicks: {
    total: number;
    byDay: { day: string; clicks: number }[];
    byStore: { store: Store; clicks: number }[];
    byGroup: { groupId: string | null; name: string; clicks: number }[];
    byOffer: { offerId: string; title: string; store: Store; clicks: number }[];
  };
  rates: GroupRate[];
  shopee: { total: SalesTotals; byGroup: ({ name: string } & SalesTotals)[]; lastSync: Date | null };
  topOffers: ({ offerId: string; title: string; store: Store; clicks: number } & SalesTotals)[];
}

const NO_GROUP = "Grupo removido";
const OUTSIDE_GROUPS = "Fora dos grupos (links divulgados por fora)";

export async function loadReportData(db: TenantDb, period: ReportPeriod): Promise<ReportData> {
  const range = { gte: period.from, lt: period.to };
  const [clicks, groups, sentByGroup, conversions] = await Promise.all([
    db.click.findMany({ where: { createdAt: range }, select: { createdAt: true, groupId: true, offerId: true } }),
    db.group.findMany({ select: { id: true, name: true, participantsCount: true } }),
    db.post.groupBy({ by: ["groupId"], where: { status: "SENT", sentAt: range }, _count: { _all: true } }),
    db.conversion.findMany({
      where: { occurredAt: range },
      select: { store: true, groupId: true, offerId: true, amountCents: true, commissionCents: true, status: true, updatedAt: true },
    }),
  ]);
  const offerIds = [...new Set([...clicks.map((c) => c.offerId), ...conversions.flatMap((c) => (c.offerId ? [c.offerId] : []))])];
  const offers = offerIds.length
    ? await db.offer.findMany({ where: { id: { in: offerIds } }, select: { id: true, title: true, store: true } })
    : [];
  const offerById = new Map(offers.map((o) => [o.id, o]));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const count = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);

  // Cliques
  const perDay = new Map<string, number>();
  const perStore = new Map<Store, number>();
  const perGroup = new Map<string | null, number>();
  const perOffer = new Map<string, number>();
  for (const c of clicks) {
    count(perDay, spDayKey(c.createdAt));
    count(perGroup, c.groupId);
    count(perOffer, c.offerId);
    const store = offerById.get(c.offerId)?.store;
    if (store) count(perStore, store);
  }
  const byDesc = <T extends { clicks: number }>(a: T, b: T) => b.clicks - a.clicks;

  // Taxa por grupo: grupos que receberam mensagem ou clique no período.
  const messages = new Map(sentByGroup.map((s) => [s.groupId, s._count._all]));
  const rateIds = new Set([...messages.keys(), ...[...perGroup.keys()].filter((id): id is string => id !== null)]);
  const rates: GroupRate[] = [...rateIds]
    .map((groupId) => {
      const group = groupById.get(groupId);
      const sent = messages.get(groupId) ?? 0;
      const clicked = perGroup.get(groupId) ?? 0;
      const members = group?.participantsCount ?? null;
      return {
        groupId,
        name: group?.name ?? NO_GROUP,
        messages: sent,
        clicks: clicked,
        members,
        clicksPerMessage: sent > 0 ? clicked / sent : null,
        pctMembers: sent > 0 && members ? (clicked / (sent * members)) * 100 : null,
      };
    })
    .sort((a, b) => b.clicks - a.clicks || b.messages - a.messages);

  // Vendas: Shopee por grupo + ofertas que mais venderam (qualquer loja com venda ligada à oferta).
  const shopeeTotal = emptySales();
  const shopeeGroups = new Map<string, SalesTotals>();
  const offerSales = new Map<string, SalesTotals>();
  let lastSync: Date | null = null;
  for (const c of conversions) {
    if (c.store === "SHOPEE") {
      addSale(shopeeTotal, c);
      const key = c.groupId ?? "";
      const totals = shopeeGroups.get(key) ?? emptySales();
      addSale(totals, c);
      shopeeGroups.set(key, totals);
      if (!lastSync || c.updatedAt > lastSync) lastSync = c.updatedAt;
    }
    if (c.offerId) {
      const totals = offerSales.get(c.offerId) ?? emptySales();
      addSale(totals, c);
      offerSales.set(c.offerId, totals);
    }
  }
  const earned = (t: SalesTotals) => t.commissionCents + t.pendingCents;

  return {
    clicks: {
      total: clicks.length,
      byDay: period.days.map((day) => ({ day, clicks: perDay.get(day) ?? 0 })),
      byStore: [...perStore].map(([store, n]) => ({ store, clicks: n })).sort(byDesc),
      byGroup: [...perGroup]
        .map(([groupId, n]) => ({ groupId, name: groupId ? (groupById.get(groupId)?.name ?? NO_GROUP) : OUTSIDE_GROUPS, clicks: n }))
        .sort(byDesc),
      byOffer: [...perOffer]
        .flatMap(([offerId, n]) => {
          const offer = offerById.get(offerId);
          return offer ? [{ offerId, title: offer.title, store: offer.store, clicks: n }] : [];
        })
        .sort(byDesc),
    },
    rates,
    shopee: {
      total: shopeeTotal,
      byGroup: [...shopeeGroups]
        .map(([groupId, t]) => ({ name: groupId ? (groupById.get(groupId)?.name ?? NO_GROUP) : OUTSIDE_GROUPS, ...t }))
        .sort((a, b) => earned(b) - earned(a)),
      lastSync,
    },
    topOffers: [...offerSales]
      .flatMap(([offerId, t]) => {
        const offer = offerById.get(offerId);
        return offer ? [{ offerId, title: offer.title, store: offer.store, clicks: perOffer.get(offerId) ?? 0, ...t }] : [];
      })
      .sort((a, b) => earned(b) - earned(a) || b.orders - a.orders),
  };
}

// ---------- Tabelas e CSV ----------

const STORE_LABEL: Record<Store, string> = {
  SHOPEE: "Shopee",
  MERCADO_LIVRE: "Mercado Livre",
  AMAZON: "Amazon",
  MAGALU: "Magalu",
  ALIEXPRESS: "AliExpress",
  SHEIN: "Shein",
  OTHER: "Outra loja",
};
export const storeLabel = (store: Store) => STORE_LABEL[store] ?? store;

/** Número no formato do Excel em português (vírgula decimal, sem milhar). */
const num = (n: number, digits = 0) => n.toFixed(digits).replace(".", ",");
const money = (cents: number) => num(cents / 100, 2);

export interface ReportTable {
  title: string;
  feature: ReportFeature;
  headers: string[];
  rows: (string | number)[][];
}

export const TABLE_KEYS = ["dias", "lojas", "grupos", "taxa", "ofertas-cliques", "vendas-grupos", "ofertas-vendas"] as const;
export type TableKey = (typeof TABLE_KEYS)[number];

export function buildTable(key: TableKey, data: ReportData): ReportTable {
  const salesCols = ["Pedidos", "Vendas (R$)", "Comissão confirmada (R$)", "Comissão pendente (R$)", "Cancelados"];
  const sales = (t: SalesTotals) => [t.orders, money(t.amountCents), money(t.commissionCents), money(t.pendingCents), t.canceled];
  switch (key) {
    case "dias":
      return { title: "Cliques por dia", feature: "daily", headers: ["Dia", "Cliques"], rows: data.clicks.byDay.map((d) => [shortDate(d.day), d.clicks]) };
    case "lojas":
      return { title: "Cliques por loja", feature: "stores", headers: ["Loja", "Cliques"], rows: data.clicks.byStore.map((s) => [storeLabel(s.store), s.clicks]) };
    case "grupos":
      return { title: "Cliques por grupo", feature: "groups", headers: ["Grupo", "Cliques"], rows: data.clicks.byGroup.map((g) => [g.name, g.clicks]) };
    case "taxa":
      return {
        title: "Taxa de cliques por grupo",
        feature: "groups",
        headers: ["Grupo", "Mensagens enviadas", "Cliques", "Cliques por mensagem", "Membros", "% dos membros (aprox.)"],
        rows: data.rates.map((r) => [
          r.name,
          r.messages,
          r.clicks,
          r.clicksPerMessage === null ? "" : num(r.clicksPerMessage, 2),
          r.members ?? "",
          r.pctMembers === null ? "" : num(r.pctMembers, 2),
        ]),
      };
    case "ofertas-cliques":
      return {
        title: "Cliques por oferta",
        feature: "offers",
        headers: ["Oferta", "Loja", "Cliques"],
        rows: data.clicks.byOffer.map((o) => [o.title, storeLabel(o.store), o.clicks]),
      };
    case "vendas-grupos":
      return {
        title: "Shopee: vendas por grupo",
        feature: "shopeeGroups",
        headers: ["Grupo", ...salesCols],
        rows: data.shopee.byGroup.map((g) => [g.name, ...sales(g)]),
      };
    case "ofertas-vendas":
      return {
        title: "Ofertas que mais venderam",
        feature: "offers",
        headers: ["Oferta", "Loja", "Cliques", ...salesCols],
        rows: data.topOffers.map((o) => [o.title, storeLabel(o.store), o.clicks, ...sales(o)]),
      };
  }
}

/** Marca UTF-8 no início do arquivo: o Excel abre os acentos certos. */
const BOM = String.fromCharCode(0xfeff);

/** Célula do CSV: aspas quando preciso e proteção contra fórmula (=, +, -, @) no Excel. */
function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV para o Excel em português: separador ";", UTF-8 com BOM e quebra de linha CRLF. */
export function toCsv(table: Pick<ReportTable, "headers" | "rows">): string {
  return `${BOM}${[table.headers, ...table.rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
}
